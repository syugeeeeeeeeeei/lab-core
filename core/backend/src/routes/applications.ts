import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { simpleGit } from "simple-git";
import { z } from "zod";
import { db, nowIso } from "../lib/db.js";
import { env } from "../lib/env.js";
import {
  executeDeleteJob,
  executeDeployJob,
  executeRebuildJob,
  executeResumeJob,
  reconcileDeploymentRouting,
  executeRestartJob,
  executeRollbackJob,
  executeStopJob,
  executeUpdateJob
} from "../services/application-jobs.js";
import {
  buildFallbackServiceCandidate as buildFallbackComposeServiceCandidate,
  buildUnavailableComposeInspection,
  composeCandidateScore,
  collectRepositoryMetadataFromPaths as collectComposeRepositoryMetadataFromPaths,
  isYamlFile,
  inspectComposeFile,
  inspectComposeYaml,
  listLocalRepositoryFiles as listComposeLocalRepositoryFiles,
  validateEnvironmentOverrides,
  validateComposeServiceSelection
} from "../services/compose-inspection.js";
import type {
  ComposeInspectionResult,
  ComposeServiceCandidate,
  RepositoryMetadata
} from "../services/compose-inspection.js";
import { recordEvent } from "../services/events.js";
import { syncInfrastructure } from "../services/infrastructure-sync.js";
import { createJob, finishJob, startJob } from "../services/jobs.js";

const createApplicationSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional().default(""),
  repositoryUrl: z.string().url(),
  defaultBranch: z.string().min(1).max(120).optional().default("main"),
  composePath: z.string().min(1).optional().default("docker-compose.yml"),
  publicServiceName: z.string().min(1),
  publicPort: z.number().int().min(1).max(65535),
  hostname: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9.-]+$/),
  mode: z.enum(["standard", "headless"]).optional().default("standard"),
  keepVolumesOnRebuild: z.boolean().optional().default(true),
  deviceRequirements: z.array(z.string().min(1)).optional().default([]),
  envOverrides: z.record(z.string().min(1), z.string()).optional().default({})
});

const resolveImportSchema = z.object({
  sourceUrl: z.string().url()
});

const inspectComposeSchema = z.object({
  repositoryUrl: z.string().url(),
  branch: z.string().min(1).max(120),
  composePath: z.string().min(1).max(400)
});

const inspectLocalComposeSchema = z.object({
  composePath: z.string().min(1).max(400)
});

const rebuildSchema = z.object({
  keepData: z.boolean().optional().default(true)
});

const deleteSchema = z.object({
  mode: z.enum(["config_only", "source_and_config", "full"]).optional().default("config_only")
});

const updateDeploymentSchema = z.object({
  composePath: z.string().min(1).max(400),
  publicServiceName: z.string().min(1).max(120),
  publicPort: z.number().int().min(1).max(65535),
  hostname: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9.-]+$/),
  keepVolumesOnRebuild: z.boolean().optional(),
  envOverrides: z.record(z.string().min(1), z.string()).optional().default({})
});

const insertApplicationStatement = db.prepare(`
  INSERT INTO applications (
    application_id,
    name,
    description,
    repository_url,
    default_branch,
    current_commit,
    previous_commit,
    status,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertDeploymentStatement = db.prepare(`
  INSERT INTO deployments (
    deployment_id,
    application_id,
    compose_path,
    public_service_name,
    public_port,
    hostname,
    mode,
    keep_volumes_on_rebuild,
    device_requirements,
    env_overrides,
    enabled
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertRouteStatement = db.prepare(`
  INSERT INTO routes (
    route_id,
    application_id,
    hostname,
    upstream_container,
    upstream_port,
    enabled
  ) VALUES (?, ?, ?, ?, ?, ?)
`);

const upsertUpdateInfoStatement = db.prepare(`
  INSERT INTO update_info (
    application_id,
    current_commit,
    latest_remote_commit,
    has_update,
    checked_at
  ) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(application_id) DO UPDATE SET
    current_commit = excluded.current_commit,
    latest_remote_commit = excluded.latest_remote_commit,
    has_update = excluded.has_update,
    checked_at = excluded.checked_at
`);

function parseJsonSafely(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseJsonObjectSafely(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
        .map(([key, entryValue]) => [key, entryValue])
    );
  } catch {
    return {};
  }
}

type ParsedGithubImportSource = {
  sourceType: "tree" | "repository";
  canonicalRepositoryUrl: string;
  treeTail: string | null;
};

type GithubRepositoryRef = {
  owner: string;
  repository: string;
};

type GithubTreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  url: string;
};

type GithubTreeResponse = {
  tree: GithubTreeEntry[];
  truncated?: boolean;
};

type GithubBlobResponse = {
  content: string;
  encoding: string;
};

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizeBranchInput(value: string): string {
  return value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function parseGithubImportSource(sourceUrl: string): ParsedGithubImportSource {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl.trim());
  } catch {
    throw new Error("GitHub URL の形式が不正です。");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== "github.com" && hostname !== "www.github.com") {
    throw new Error("GitHub の URL のみ指定できます。");
  }

  const segments = parsedUrl.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeSegment(segment));

  if (segments.length < 2) {
    throw new Error("リポジトリ URL は /<owner>/<repo> 形式で指定してください。");
  }

  const owner = segments[0].trim();
  const rawRepo = segments[1].trim();
  const repository = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;

  if (owner.length === 0 || repository.length === 0) {
    throw new Error("GitHub URL から owner/repo を解釈できません。");
  }

  const canonicalRepositoryUrl = `https://github.com/${owner}/${repository}.git`;
  const hasTreePath = segments[2] === "tree";
  const rawTreeTail = hasTreePath ? segments.slice(3).join("/") : "";
  const treeTail = normalizeBranchInput(rawTreeTail);

  if (hasTreePath) {
    return {
      sourceType: "tree",
      canonicalRepositoryUrl,
      treeTail: treeTail.length > 0 ? treeTail : null
    };
  }

  return {
    sourceType: "repository",
    canonicalRepositoryUrl,
    treeTail: null
  };
}

function selectBestBranch(treeTail: string | null, branchCandidates: string[]): { branch: string; matched: boolean } {
  if (!treeTail) {
    if (branchCandidates.includes("main")) {
      return { branch: "main", matched: true };
    }
    if (branchCandidates.length > 0) {
      return { branch: branchCandidates[0], matched: true };
    }
    return { branch: "main", matched: false };
  }

  const normalizedTail = normalizeBranchInput(treeTail);
  let bestMatch = "";
  for (const branch of branchCandidates) {
    if (normalizedTail === branch || normalizedTail.startsWith(`${branch}/`)) {
      if (branch.length > bestMatch.length) {
        bestMatch = branch;
      }
    }
  }

  if (bestMatch.length > 0) {
    return { branch: bestMatch, matched: true };
  }

  return { branch: normalizedTail, matched: false };
}

async function fetchRemoteBranches(repositoryUrl: string): Promise<string[]> {
  const output = await simpleGit().listRemote([repositoryUrl, "--heads"]);
  const branches = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/refs\/heads\/(.+)$/);
      return match ? match[1].trim() : "";
    })
    .filter((branch) => branch.length > 0);

  return [...new Set(branches)].sort((a, b) => a.localeCompare(b));
}

function normalizeCreateImportInput(repositoryUrl: string, defaultBranch: string): { repositoryUrl: string; defaultBranch: string } {
  const parsed = parseGithubImportSource(repositoryUrl);

  if (parsed.sourceType === "repository") {
    return {
      repositoryUrl: parsed.canonicalRepositoryUrl,
      defaultBranch: "main"
    };
  }

  const preferredBranch = normalizeBranchInput(defaultBranch);
  const resolvedBranch = preferredBranch.length > 0 ? preferredBranch : (parsed.treeTail ?? "main");

  if (resolvedBranch.length > 120) {
    throw new Error("ブランチ名が長すぎます。");
  }

  return {
    repositoryUrl: parsed.canonicalRepositoryUrl,
    defaultBranch: resolvedBranch
  };
}

function normalizeGithubRepositoryUrl(repositoryUrl: string): string {
  return parseGithubImportSource(repositoryUrl).canonicalRepositoryUrl;
}

function parseCanonicalGithubRepository(repositoryUrl: string): GithubRepositoryRef {
  const normalized = normalizeCreateImportInput(repositoryUrl, "main");
  const parsedUrl = new URL(normalized.repositoryUrl);
  const segments = parsedUrl.pathname.split("/").filter((segment) => segment.length > 0);

  if (segments.length < 2) {
    throw new Error("GitHub リポジトリ URL を解釈できません。");
  }

  return {
    owner: segments[0],
    repository: segments[1].endsWith(".git") ? segments[1].slice(0, -4) : segments[1]
  };
}

async function fetchGithubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "lab-core-backend"
    }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub API ${response.status}: ${detail || "取得に失敗しました。"}`);
  }

  return (await response.json()) as T;
}

async function fetchRepositoryTree(repositoryUrl: string, branch: string): Promise<GithubTreeEntry[]> {
  const ref = parseCanonicalGithubRepository(repositoryUrl);
  const normalizedBranch = normalizeBranchInput(branch);
  const treeUrl = `https://api.github.com/repos/${ref.owner}/${ref.repository}/git/trees/${encodeURIComponent(normalizedBranch)}?recursive=1`;

  try {
    const directTree = await fetchGithubJson<GithubTreeResponse>(treeUrl);
    return directTree.tree.filter((entry) => entry.type === "blob");
  } catch {
    const refUrl = `https://api.github.com/repos/${ref.owner}/${ref.repository}/git/ref/heads/${encodeURIComponent(normalizedBranch)}`;
    const refResponse = await fetchGithubJson<{ object?: { sha?: string } }>(refUrl);
    const refSha = refResponse.object?.sha;

    if (!refSha) {
      throw new Error(`branch ${normalizedBranch} の参照先を取得できません。`);
    }

    const commitResponse = await fetchGithubJson<{ tree?: { sha?: string } }>(
      `https://api.github.com/repos/${ref.owner}/${ref.repository}/git/commits/${refSha}`
    );
    const treeSha = commitResponse.tree?.sha;

    if (!treeSha) {
      throw new Error(`branch ${normalizedBranch} の tree sha を取得できません。`);
    }

    const treeFromCommit = await fetchGithubJson<GithubTreeResponse>(
      `https://api.github.com/repos/${ref.owner}/${ref.repository}/git/trees/${treeSha}?recursive=1`
    );
    return treeFromCommit.tree.filter((entry) => entry.type === "blob");
  }
}

async function withTemporaryGitClone<T>(
  repositoryUrl: string,
  branch: string,
  run: (repoPath: string) => Promise<T>
): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lab-core-remote-"));
  const normalizedBranch = normalizeBranchInput(branch);

  try {
    await simpleGit().clone(repositoryUrl, tempRoot, [
      "--depth",
      "1",
      "--branch",
      normalizedBranch,
      "--single-branch"
    ]);
    return await run(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function fetchBlobContent(blobUrl: string): Promise<string> {
  const blob = await fetchGithubJson<GithubBlobResponse>(blobUrl);
  if (blob.encoding !== "base64") {
    throw new Error(`未対応の blob encoding です: ${blob.encoding}`);
  }
  return Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function collectRepositoryMetadataFromRemote(repositoryUrl: string, branch: string): Promise<RepositoryMetadata> {
  try {
    const entries = await fetchRepositoryTree(repositoryUrl, branch);
    return collectRepositoryMetadata(entries);
  } catch {
    return withTemporaryGitClone(repositoryUrl, branch, async (repoPath) =>
      collectRepositoryMetadataFromPaths(listLocalRepositoryFiles(repoPath))
    );
  }
}

function collectRepositoryMetadataFromPaths(repositoryFiles: string[]): RepositoryMetadata {
  return collectComposeRepositoryMetadataFromPaths(repositoryFiles);
}

function collectRepositoryMetadata(entries: GithubTreeEntry[]): RepositoryMetadata {
  return collectRepositoryMetadataFromPaths(entries.map((entry) => entry.path));
}

function listLocalRepositoryFiles(repoPath: string): string[] {
  return listComposeLocalRepositoryFiles(repoPath);
}

function buildFallbackServiceCandidate(serviceName: string, publicPort: number): ComposeServiceCandidate {
  return buildFallbackComposeServiceCandidate(serviceName, publicPort);
}

function resolveSelectedComposePath(composePath: string, metadata: RepositoryMetadata): string {
  const normalizedComposePath = composePath.trim().replace(/^\/+/, "");
  return normalizedComposePath.length > 0
    ? normalizedComposePath
    : (metadata.recommendedComposePath ?? metadata.composeCandidates[0] ?? "");
}

async function inspectComposeFromLocalRepository(
  repoPath: string,
  composePath: string,
  fallbackServiceName: string,
  fallbackPort: number,
  options: {
    repositoryUrl?: string;
    branch?: string;
  } = {}
): Promise<ComposeInspectionResult> {
  const fallbackServices = [buildFallbackServiceCandidate(fallbackServiceName, fallbackPort)];

  if (!fs.existsSync(repoPath)) {
    if (options.repositoryUrl && options.branch) {
      try {
        return await inspectComposeFromRepository(options.repositoryUrl, options.branch, composePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : "compose の取得に失敗しました。";
        return buildUnavailableComposeInspection({
          composeCandidates: composePath.length > 0 ? [composePath] : [],
          yamlFiles: composePath.length > 0 ? [composePath] : [],
          recommendedComposePath: composePath.length > 0 ? composePath : null,
          selectedComposePath: composePath.trim().replace(/^\/+/, ""),
          source: {
            kind: "github",
            path: composePath.trim().replace(/^\/+/, ""),
            repositoryUrl: options.repositoryUrl,
            branch: options.branch
          },
          message,
          fallbackServices
        });
      }
    }

    return buildUnavailableComposeInspection({
      composeCandidates: composePath.length > 0 ? [composePath] : [],
      yamlFiles: composePath.length > 0 ? [composePath] : [],
      recommendedComposePath: composePath.length > 0 ? composePath : null,
      selectedComposePath: composePath.trim().replace(/^\/+/, ""),
      source: {
        kind: "local",
        path: composePath.trim().replace(/^\/+/, "")
      },
      message: "ローカルリポジトリがまだ取得されていません。",
      fallbackServices
    });
  }

  const metadata = collectRepositoryMetadataFromPaths(listLocalRepositoryFiles(repoPath));
  const normalizedComposePath = resolveSelectedComposePath(composePath, metadata);
  const candidateSet = new Set(metadata.composeCandidates);
  const yamlSet = new Set(metadata.yamlFiles);

  if (normalizedComposePath.length > 0) {
    if (isYamlFile(normalizedComposePath)) {
      yamlSet.add(normalizedComposePath);
    }
    if (composeCandidateScore(normalizedComposePath) > 0) {
      candidateSet.add(normalizedComposePath);
    }
  }

  const composeCandidates = [...candidateSet].sort((a, b) => {
    const scoreDiff = composeCandidateScore(b) - composeCandidateScore(a);
    return scoreDiff !== 0 ? scoreDiff : a.localeCompare(b);
  });
  const yamlFiles = [...yamlSet].sort((a, b) => a.localeCompare(b));
  const selectedComposePath = normalizedComposePath;

  if (selectedComposePath.length === 0) {
    return buildUnavailableComposeInspection({
      composeCandidates,
      yamlFiles,
      recommendedComposePath: metadata.recommendedComposePath,
      selectedComposePath: "",
      source: {
        kind: "local",
        path: ""
      },
      message: "compose 候補を検出できませんでした。",
      fallbackServices
    });
  }

  const composeFilePath = path.resolve(repoPath, selectedComposePath);
  if (!fs.existsSync(composeFilePath)) {
    if (options.repositoryUrl && options.branch) {
      try {
        return await inspectComposeFromRepository(options.repositoryUrl, options.branch, selectedComposePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : `compose ファイルが見つかりません: ${selectedComposePath}`;
        return buildUnavailableComposeInspection({
          composeCandidates,
          yamlFiles,
          recommendedComposePath: metadata.recommendedComposePath,
          selectedComposePath,
          source: {
            kind: "github",
            path: selectedComposePath,
            repositoryUrl: options.repositoryUrl,
            branch: options.branch
          },
          message,
          fallbackServices
        });
      }
    }

    return buildUnavailableComposeInspection({
      composeCandidates,
      yamlFiles,
      recommendedComposePath: metadata.recommendedComposePath,
      selectedComposePath,
      source: {
        kind: "local",
        path: selectedComposePath,
        absolutePath: composeFilePath
      },
      message: `compose ファイルが見つかりません: ${selectedComposePath}`,
      fallbackServices
    });
  }

  return inspectComposeFile({
    absolutePath: composeFilePath,
    composeCandidates,
    yamlFiles,
    recommendedComposePath: metadata.recommendedComposePath,
    selectedComposePath,
    source: {
      repositoryUrl: options.repositoryUrl,
      branch: options.branch
    }
  });
}

async function inspectComposeForApplicationRepository(
  repoPath: string,
  composePath: string,
  fallbackServiceName: string,
  fallbackPort: number,
  options: {
    repositoryUrl?: string;
    branch?: string;
  } = {}
): Promise<ComposeInspectionResult> {
  if (options.repositoryUrl && options.branch) {
    try {
      return await inspectComposeFromRepository(options.repositoryUrl, options.branch, composePath);
    } catch {
      // Fall back to the local checkout when the remote repository is unavailable.
    }
  }

  return inspectComposeFromLocalRepository(repoPath, composePath, fallbackServiceName, fallbackPort, options);
}

function validateSelectedComposeService(
  composeInspection: ComposeInspectionResult,
  serviceName: string,
  composePath: string
): void {
  validateComposeServiceSelection(composeInspection, serviceName, composePath);
}

async function inspectComposeFromRepository(
  repositoryUrl: string,
  branch: string,
  composePath: string
): Promise<ComposeInspectionResult> {
  try {
    const entries = await fetchRepositoryTree(repositoryUrl, branch);
    const metadata = collectRepositoryMetadata(entries);
    const normalizedPath = resolveSelectedComposePath(composePath, metadata);
    const matchedEntry = entries.find((entry) => entry.path === normalizedPath);

    if (!matchedEntry) {
      throw new Error(`compose ファイルが見つかりません: ${normalizedPath}`);
    }

    const content = await fetchBlobContent(matchedEntry.url);
    return inspectComposeYaml({
      rawYaml: content,
      composeCandidates: metadata.composeCandidates,
      yamlFiles: metadata.yamlFiles,
      recommendedComposePath: metadata.recommendedComposePath,
      selectedComposePath: normalizedPath,
      source: {
        kind: "github",
        path: normalizedPath,
        repositoryUrl,
        branch,
        blobUrl: matchedEntry.url
      }
    });
  } catch {
    return withTemporaryGitClone(repositoryUrl, branch, async (repoPath) => {
      const metadata = collectRepositoryMetadataFromPaths(listLocalRepositoryFiles(repoPath));
      const normalizedPath = resolveSelectedComposePath(composePath, metadata);

      if (normalizedPath.length === 0) {
        throw new Error("compose 候補を検出できませんでした。");
      }

      const absolutePath = path.resolve(repoPath, normalizedPath);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`compose ファイルが見つかりません: ${normalizedPath}`);
      }

      const rawYaml = fs.readFileSync(absolutePath, "utf8");
      return inspectComposeYaml({
        rawYaml,
        composeCandidates: metadata.composeCandidates,
        yamlFiles: metadata.yamlFiles,
        recommendedComposePath: metadata.recommendedComposePath,
        selectedComposePath: normalizedPath,
        source: {
          kind: "github",
          path: normalizedPath,
          repositoryUrl,
          branch
        }
      });
    });
  }
}

export const applicationsRouter = new Hono();

applicationsRouter.get("/", (c) => {
  const applications = db
    .prepare(
      `
        SELECT
          a.application_id,
          a.name,
          a.description,
          a.repository_url,
          a.default_branch,
          a.current_commit,
          a.previous_commit,
          a.status,
          a.created_at,
          a.updated_at,
          d.hostname,
          d.public_service_name,
          d.public_port,
          d.mode,
          d.keep_volumes_on_rebuild,
          d.device_requirements,
          d.enabled,
          u.latest_remote_commit,
          u.has_update,
          u.checked_at,
          (
            SELECT se.title
            FROM system_events se
            WHERE se.application_id = a.application_id
              AND se.level = 'error'
            ORDER BY se.created_at DESC
            LIMIT 1
          ) AS latest_error_title,
          (
            SELECT se.message
            FROM system_events se
            WHERE se.application_id = a.application_id
              AND se.level = 'error'
            ORDER BY se.created_at DESC
            LIMIT 1
          ) AS latest_error_message,
          (
            SELECT se.created_at
            FROM system_events se
            WHERE se.application_id = a.application_id
              AND se.level = 'error'
            ORDER BY se.created_at DESC
            LIMIT 1
          ) AS latest_error_at,
          (
            SELECT j.type
            FROM jobs j
            WHERE j.related_application_id = a.application_id
            ORDER BY j.created_at DESC
            LIMIT 1
          ) AS latest_job_type,
          (
            SELECT j.status
            FROM jobs j
            WHERE j.related_application_id = a.application_id
            ORDER BY j.created_at DESC
            LIMIT 1
          ) AS latest_job_status,
          (
            SELECT j.message
            FROM jobs j
            WHERE j.related_application_id = a.application_id
            ORDER BY j.created_at DESC
            LIMIT 1
          ) AS latest_job_message,
          (
            SELECT j.created_at
            FROM jobs j
            WHERE j.related_application_id = a.application_id
            ORDER BY j.created_at DESC
            LIMIT 1
          ) AS latest_job_created_at,
          (
            SELECT j.started_at
            FROM jobs j
            WHERE j.related_application_id = a.application_id
            ORDER BY j.created_at DESC
            LIMIT 1
          ) AS latest_job_started_at,
          (
            SELECT j.finished_at
            FROM jobs j
            WHERE j.related_application_id = a.application_id
            ORDER BY j.created_at DESC
            LIMIT 1
          ) AS latest_job_finished_at
        FROM applications a
        LEFT JOIN deployments d ON d.application_id = a.application_id
        LEFT JOIN update_info u ON u.application_id = a.application_id
        ORDER BY a.created_at DESC
      `
    )
    .all() as Array<Record<string, unknown>>;

  const normalized = applications.map((row) => ({
    ...row,
    keep_volumes_on_rebuild: Boolean(row.keep_volumes_on_rebuild),
    enabled: Boolean(row.enabled),
    has_update: Boolean(row.has_update),
    device_requirements: parseJsonSafely(String(row.device_requirements ?? "[]"))
  }));

  return c.json({ applications: normalized });
});

applicationsRouter.post("/import/resolve", async (c) => {
  const payload = await c.req.json().catch(() => null);
  if (!payload) {
    return c.json({ message: "JSON 形式で入力してください。" }, 400);
  }

  const parsedPayload = resolveImportSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return c.json({ message: "入力値が不正です。", issues: parsedPayload.error.issues }, 400);
  }

  let parsedSource: ParsedGithubImportSource;
  try {
    parsedSource = parseGithubImportSource(parsedPayload.data.sourceUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub URL の解析に失敗しました。";
    return c.json({ message }, 400);
  }

  let branchCandidates: string[] = [];
  let resolvedBranch = parsedSource.sourceType === "repository" ? "main" : (parsedSource.treeTail ?? "main");
  const warnings: string[] = [];

  try {
    if (parsedSource.sourceType === "tree") {
      branchCandidates = await fetchRemoteBranches(parsedSource.canonicalRepositoryUrl);
      const bestBranch = selectBestBranch(parsedSource.treeTail, branchCandidates);
      resolvedBranch = bestBranch.branch;

      if (!bestBranch.matched && parsedSource.treeTail) {
        warnings.push("tree URL の末尾をブランチとして解釈しました。候補から確認してください。");
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "不明なエラー";
    warnings.push(`ブランチ一覧の取得に失敗しました。手入力で継続できます。(${detail})`);
  }

  let repositoryFiles: string[] = [];
  let yamlFiles: string[] = [];
  let composeCandidates: string[] = [];
  let recommendedComposePath: string | null = null;

  try {
    const metadata = await collectRepositoryMetadataFromRemote(parsedSource.canonicalRepositoryUrl, resolvedBranch);
    repositoryFiles = metadata.repositoryFiles;
    yamlFiles = metadata.yamlFiles;
    composeCandidates = metadata.composeCandidates;
    recommendedComposePath = metadata.recommendedComposePath;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "不明なエラー";
    warnings.push(`リポジトリ内ファイル一覧の取得に失敗しました。(${detail})`);
  }

  return c.json({
    canonicalRepositoryUrl: parsedSource.canonicalRepositoryUrl,
    resolvedBranch,
    branchFixed: parsedSource.sourceType === "repository",
    branchCandidates,
    repositoryFiles,
    yamlFiles,
    composeCandidates,
    recommendedComposePath,
    warning: warnings.length > 0 ? warnings.join(" ") : undefined
  });
});

applicationsRouter.post("/import/compose-inspect", async (c) => {
  const payload = await c.req.json().catch(() => null);
  if (!payload) {
    return c.json({ message: "JSON 形式で入力してください。" }, 400);
  }

  const parsedPayload = inspectComposeSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return c.json({ message: "入力値が不正です。", issues: parsedPayload.error.issues }, 400);
  }

  let normalizedRepositoryUrl: string;
  let normalizedBranch: string;
  try {
    normalizedRepositoryUrl = normalizeGithubRepositoryUrl(parsedPayload.data.repositoryUrl);
    normalizedBranch = normalizeBranchInput(parsedPayload.data.branch);
    if (normalizedBranch.length === 0) {
      throw new Error("ブランチ名を解釈できません。");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub URL の解釈に失敗しました。";
    return c.json({ message }, 400);
  }

  try {
    const inspection = await inspectComposeFromRepository(
      normalizedRepositoryUrl,
      normalizedBranch,
      parsedPayload.data.composePath
    );
    return c.json(inspection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "compose 解析に失敗しました。";
    return c.json({ message }, 400);
  }
});

applicationsRouter.get("/:applicationId", async (c) => {
  const applicationId = c.req.param("applicationId");

  const application = db
    .prepare(
      `
        SELECT
          application_id,
          name,
          description,
          repository_url,
          default_branch,
          current_commit,
          previous_commit,
          status,
          created_at,
          updated_at
        FROM applications
        WHERE application_id = ?
      `
    )
    .get(applicationId) as Record<string, unknown> | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  const deployment = db
    .prepare(
      `
        SELECT
          deployment_id,
          compose_path,
          public_service_name,
          public_port,
          hostname,
          mode,
          keep_volumes_on_rebuild,
          device_requirements,
          env_overrides,
          enabled
        FROM deployments
        WHERE application_id = ?
      `
    )
    .get(applicationId) as
    | {
        deployment_id: string;
        compose_path: string;
        public_service_name: string;
        public_port: number;
        hostname: string;
        mode: string;
        keep_volumes_on_rebuild: number;
        device_requirements: string;
        env_overrides: string;
        enabled: number;
      }
    | undefined;

  const routes = db
    .prepare(
      `
        SELECT route_id, hostname, upstream_container, upstream_port, enabled
        FROM routes
        WHERE application_id = ?
        ORDER BY hostname ASC
      `
    )
    .all(applicationId);

  const containers = db
    .prepare(
      `
        SELECT container_id, service_name, runtime_name, health_state, restart_count, last_seen_at
        FROM container_instances
        WHERE application_id = ?
        ORDER BY service_name ASC
      `
    )
    .all(applicationId);

  const events = db
    .prepare(
      `
        SELECT event_id, scope, level, title, message, created_at
        FROM system_events
        WHERE application_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `
    )
    .all(applicationId);

  const updateInfo = db
    .prepare(
      `
        SELECT current_commit, latest_remote_commit, has_update, checked_at
        FROM update_info
        WHERE application_id = ?
      `
    )
    .get(applicationId);

  const normalizedDeployment = deployment
    ? {
        ...deployment,
        keep_volumes_on_rebuild: Boolean(deployment.keep_volumes_on_rebuild),
        enabled: Boolean(deployment.enabled),
        device_requirements: parseJsonSafely(String(deployment.device_requirements ?? "[]")),
        env_overrides: parseJsonObjectSafely(String(deployment.env_overrides ?? "{}"))
      }
    : null;

  const composeInspection = normalizedDeployment
    ? await inspectComposeForApplicationRepository(
        path.join(env.appsRoot, String(application.name)),
        String(normalizedDeployment.compose_path),
        String(normalizedDeployment.public_service_name),
        Number(normalizedDeployment.public_port),
        {
          repositoryUrl: String(application.repository_url),
          branch: String(application.default_branch)
        }
      )
    : null;

  const normalizedRoutes = (routes as Array<Record<string, unknown>>).map((route) => ({
    ...route,
    enabled: Boolean(route.enabled)
  }));

  return c.json({
    application,
    deployment: normalizedDeployment,
    composeInspection,
    routes: normalizedRoutes,
    containers,
    updateInfo: updateInfo ? { ...updateInfo, has_update: Boolean((updateInfo as Record<string, unknown>).has_update) } : null,
    events
  });
});

applicationsRouter.post("/:applicationId/deployment/inspect", async (c) => {
  const applicationId = c.req.param("applicationId");
  const payload = await c.req.json().catch(() => null);
  if (!payload) {
    return c.json({ message: "JSON 形式で入力してください。" }, 400);
  }

  const parsed = inspectLocalComposeSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ message: "入力値が不正です。", issues: parsed.error.issues }, 400);
  }

  const application = db
    .prepare(
      `
        SELECT a.name, a.repository_url, a.default_branch, d.public_service_name, d.public_port
        FROM applications a
        INNER JOIN deployments d ON d.application_id = a.application_id
        WHERE a.application_id = ?
      `
    )
    .get(applicationId) as
    | {
        name: string;
        repository_url: string;
        default_branch: string;
        public_service_name: string;
        public_port: number;
      }
    | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  const inspection = await inspectComposeForApplicationRepository(
    path.join(env.appsRoot, application.name),
    parsed.data.composePath,
    application.public_service_name,
    application.public_port,
    {
      repositoryUrl: application.repository_url,
      branch: application.default_branch
    }
  );

  return c.json(inspection);
});

applicationsRouter.patch("/:applicationId/deployment", async (c) => {
  const applicationId = c.req.param("applicationId");
  const payload = await c.req.json().catch(() => null);
  if (!payload) {
    return c.json({ message: "JSON 形式で入力してください。" }, 400);
  }

  const parsed = updateDeploymentSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ message: "入力値が不正です。", issues: parsed.error.issues }, 400);
  }

  const application = db
    .prepare(
      `
        SELECT application_id, name, repository_url, default_branch
        FROM applications
        WHERE application_id = ?
      `
    )
    .get(applicationId) as
    | {
        application_id: string;
        name: string;
        repository_url: string;
        default_branch: string;
      }
    | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  const currentDeployment = db
    .prepare(
      `
        SELECT compose_path, public_service_name, public_port, hostname, keep_volumes_on_rebuild, env_overrides
        FROM deployments
        WHERE application_id = ?
      `
    )
    .get(applicationId) as
    | {
        compose_path: string;
        public_service_name: string;
        public_port: number;
        hostname: string;
        keep_volumes_on_rebuild: number;
        env_overrides: string;
      }
    | undefined;

  if (!currentDeployment) {
    return c.json({ message: "対象アプリの配備設定が見つかりません。" }, 404);
  }

  const data = parsed.data;
  const keepVolumesOnRebuild = data.keepVolumesOnRebuild ?? Boolean(currentDeployment.keep_volumes_on_rebuild);
  const updatedAt = nowIso();
  const repoPath = path.join(env.appsRoot, application.name);
  const composeInspection = await inspectComposeForApplicationRepository(
    repoPath,
    data.composePath,
    currentDeployment.public_service_name,
    currentDeployment.public_port,
    {
      repositoryUrl: application.repository_url,
      branch: application.default_branch
    }
  );

  try {
    validateSelectedComposeService(composeInspection, data.publicServiceName, data.composePath);
    validateEnvironmentOverrides(composeInspection, data.envOverrides);
  } catch (error) {
    const message = error instanceof Error ? error.message : "compose 候補の検証に失敗しました。";
    return c.json({ message }, 400);
  }

  try {
    db.transaction(() => {
      db.prepare(
        `
          UPDATE deployments
          SET compose_path = ?,
              public_service_name = ?,
              public_port = ?,
              hostname = ?,
              keep_volumes_on_rebuild = ?,
              env_overrides = ?
          WHERE application_id = ?
        `
      ).run(
        data.composePath,
        data.publicServiceName,
        data.publicPort,
        data.hostname,
        keepVolumesOnRebuild ? 1 : 0,
        JSON.stringify(data.envOverrides),
        applicationId
      );

      db.prepare(
        `
          UPDATE routes
          SET hostname = ?,
              upstream_container = ?,
              upstream_port = ?
          WHERE application_id = ?
        `
      ).run(data.hostname, data.publicServiceName, data.publicPort, applicationId);

      db.prepare(
        `
          UPDATE applications
          SET updated_at = ?
          WHERE application_id = ?
        `
      ).run(updatedAt, applicationId);
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    if (message.includes("UNIQUE")) {
      return c.json({ message: "同じホスト名の設定が既に存在します。" }, 409);
    }
    return c.json({ message: "配備設定の更新に失敗しました。", detail: message }, 500);
  }

  const composeFilePath = path.resolve(repoPath, data.composePath);
  const routing = reconcileDeploymentRouting(applicationId, composeFilePath, data.publicServiceName, data.publicPort);
  syncInfrastructure(`deployment-update:${application.name}`);

  const requestedChanges: string[] = [];
  if (currentDeployment.compose_path !== data.composePath) {
    requestedChanges.push(`compose=${currentDeployment.compose_path} -> ${data.composePath}`);
  }
  if (currentDeployment.public_service_name !== data.publicServiceName || currentDeployment.public_port !== data.publicPort) {
    requestedChanges.push(
      `公開先=${currentDeployment.public_service_name}:${currentDeployment.public_port} -> ${data.publicServiceName}:${data.publicPort}`
    );
  }
  if (currentDeployment.hostname !== data.hostname) {
    requestedChanges.push(`host=${currentDeployment.hostname} -> ${data.hostname}`);
  }
  if (Boolean(currentDeployment.keep_volumes_on_rebuild) !== keepVolumesOnRebuild) {
    requestedChanges.push(`keepVolumesOnRebuild=${keepVolumesOnRebuild}`);
  }
  if (String(currentDeployment.env_overrides ?? "{}") !== JSON.stringify(data.envOverrides)) {
    requestedChanges.push(`envOverrides=${Object.keys(data.envOverrides).length}件`);
  }

  recordEvent({
    scope: "deployment",
    applicationId,
    level: routing.corrected ? "warning" : "info",
    title: "配備設定を更新しました",
    message: [
      requestedChanges.length > 0 ? requestedChanges.join(", ") : "設定を保存しました。",
      routing.reason
    ].join(" | ")
  });

  return c.json({
    message: routing.corrected ? `配備設定を更新しました。${routing.reason}` : "配備設定を更新しました。",
    routing
  });
});

applicationsRouter.post("/", async (c) => {
  const payload = await c.req.json().catch(() => null);
  if (!payload) {
    return c.json({ message: "JSON 形式で入力してください。" }, 400);
  }

  const parsed = createApplicationSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      {
        message: "入力値が不正です。",
        issues: parsed.error.issues
      },
      400
    );
  }

  const data = parsed.data;

  let normalizedImportInput: { repositoryUrl: string; defaultBranch: string };
  try {
    normalizedImportInput = normalizeCreateImportInput(data.repositoryUrl, data.defaultBranch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub URL の解釈に失敗しました。";
    return c.json({ message }, 400);
  }

  try {
    const inspection = await inspectComposeFromRepository(
      normalizedImportInput.repositoryUrl,
      normalizedImportInput.defaultBranch,
      data.composePath
    );
    validateSelectedComposeService(inspection, data.publicServiceName, data.composePath);
    validateEnvironmentOverrides(inspection, data.envOverrides);
  } catch (error) {
    const message = error instanceof Error ? error.message : "compose 解析に失敗しました。";
    return c.json({ message }, 400);
  }

  const applicationId = nanoid();
  const deploymentId = nanoid();
  const routeId = nanoid();
  const createdAt = nowIso();

  const tx = db.transaction(() => {
    insertApplicationStatement.run(
      applicationId,
      data.name,
      data.description,
      normalizedImportInput.repositoryUrl,
      normalizedImportInput.defaultBranch,
      null,
      null,
      "Build Pending",
      createdAt,
      createdAt
    );

    insertDeploymentStatement.run(
      deploymentId,
      applicationId,
      data.composePath,
      data.publicServiceName,
      data.publicPort,
      data.hostname,
      data.mode,
      data.keepVolumesOnRebuild ? 1 : 0,
      JSON.stringify(data.deviceRequirements),
      JSON.stringify(data.envOverrides),
      1
    );

    insertRouteStatement.run(routeId, applicationId, data.hostname, data.publicServiceName, data.publicPort, 1);

    const jobId = createJob("deploy", applicationId, "初回デプロイ待機中です。");
    recordEvent({
      scope: "application",
      applicationId,
      level: "info",
      title: "アプリを登録しました",
      message: `アプリ ${data.name} を登録しました。job_id=${jobId}`
    });

    return jobId;
  });

  try {
    const jobId = tx();
    try {
      syncInfrastructure(`register:${data.name}`);
    } catch (syncError) {
      recordEvent({
        scope: "infrastructure",
        applicationId,
        level: "warning",
        title: "初回 DNS/Proxy 同期に失敗しました",
        message: syncError instanceof Error ? syncError.message : "不明なエラー"
      });
    }
    void executeDeployJob(applicationId, jobId);
    return c.json({ applicationId, deploymentId, routeId, jobId, message: "デプロイジョブを開始しました。" }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    if (message.includes("UNIQUE")) {
      return c.json({ message: "同じアプリ名またはホスト名が既に登録されています。" }, 409);
    }
    return c.json({ message: "アプリ登録に失敗しました。", detail: message }, 500);
  }
});

applicationsRouter.post("/:applicationId/restart", async (c) => {
  const applicationId = c.req.param("applicationId");

  const application = db
    .prepare("SELECT name FROM applications WHERE application_id = ?")
    .get(applicationId) as { name: string } | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  const jobId = createJob("restart", applicationId, "再起動ジョブを作成しました。");
  void executeRestartJob(applicationId, jobId);

  return c.json(
    {
      jobId,
      message: `${application.name} の再起動ジョブを開始しました。`
    },
    202
  );
});

applicationsRouter.post("/:applicationId/stop", async (c) => {
  const applicationId = c.req.param("applicationId");

  const application = db
    .prepare(
      `
        SELECT a.name, d.enabled
        FROM applications a
        INNER JOIN deployments d ON d.application_id = a.application_id
        WHERE a.application_id = ?
      `
    )
    .get(applicationId) as { name: string; enabled: number } | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  if (!application.enabled) {
    return c.json({ message: "このアプリは既に停止しています。" }, 400);
  }

  const jobId = createJob("stop", applicationId, "停止ジョブを作成しました。");
  void executeStopJob(applicationId, jobId);

  return c.json(
    {
      jobId,
      message: `${application.name} の停止ジョブを開始しました。`
    },
    202
  );
});

applicationsRouter.post("/:applicationId/resume", async (c) => {
  const applicationId = c.req.param("applicationId");

  const application = db
    .prepare(
      `
        SELECT a.name, d.enabled
        FROM applications a
        INNER JOIN deployments d ON d.application_id = a.application_id
        WHERE a.application_id = ?
      `
    )
    .get(applicationId) as { name: string; enabled: number } | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  if (application.enabled) {
    return c.json({ message: "このアプリは既に公開中です。" }, 400);
  }

  const jobId = createJob("resume", applicationId, "再開ジョブを作成しました。");
  void executeResumeJob(applicationId, jobId);

  return c.json(
    {
      jobId,
      message: `${application.name} の再開ジョブを開始しました。`
    },
    202
  );
});

applicationsRouter.post("/:applicationId/rebuild", async (c) => {
  const applicationId = c.req.param("applicationId");
  const payload = await c.req.json().catch(() => ({}));

  const parsed = rebuildSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ message: "入力値が不正です。", issues: parsed.error.issues }, 400);
  }

  const application = db
    .prepare("SELECT name FROM applications WHERE application_id = ?")
    .get(applicationId) as { name: string } | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  const keepData = parsed.data.keepData;
  const jobId = createJob("rebuild", applicationId, "再ビルドジョブを作成しました。");
  void executeRebuildJob(applicationId, jobId, keepData);

  return c.json(
    {
      jobId,
      keepData,
      message: `${application.name} の再ビルドジョブを開始しました。`
    },
    202
  );
});

applicationsRouter.post("/:applicationId/update-check", async (c) => {
  const applicationId = c.req.param("applicationId");

  const application = db
    .prepare(
      `
        SELECT name, default_branch, current_commit
        FROM applications
        WHERE application_id = ?
      `
    )
    .get(applicationId) as { name: string; default_branch: string; current_commit: string | null } | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  const jobId = createJob("update", applicationId, "更新確認ジョブを作成しました。");
  startJob(jobId, "リモートとの差分確認を開始します。");

  const repoPath = path.join(env.appsRoot, application.name);
  if (env.executionMode === "dry-run") {
    const currentCommit = application.current_commit ?? "dry-run-current";
    const latestRemoteCommit = `dry-run-remote-${Date.now()}`;
    const hasUpdate = currentCommit !== latestRemoteCommit;

    upsertUpdateInfoStatement.run(applicationId, currentCommit, latestRemoteCommit, hasUpdate ? 1 : 0, nowIso());
    finishJob(jobId, "succeeded", hasUpdate ? "更新があります。" : "最新状態です。");
    recordEvent({
      scope: "update",
      applicationId,
      level: hasUpdate ? "warning" : "info",
      title: hasUpdate ? "更新があります" : "更新なし",
      message: hasUpdate
        ? `remote=${latestRemoteCommit} / current=${currentCommit}`
        : `最新コミット (${currentCommit}) を確認しました。`
    });

    return c.json({
      jobId,
      hasUpdate,
      currentCommit,
      latestRemoteCommit
    });
  }

  if (!fs.existsSync(repoPath)) {
    const message = `ローカルリポジトリが見つかりません: ${repoPath}`;
    finishJob(jobId, "failed", message);
    recordEvent({
      scope: "update",
      applicationId,
      level: "warning",
      title: "更新確認に失敗しました",
      message
    });
    return c.json({ message: "更新確認に失敗しました。ローカルソースがありません。", detail: message, jobId }, 400);
  }

  try {
    const git = simpleGit(repoPath);
    await git.fetch();

    const currentCommit = (await git.revparse(["HEAD"])).trim();
    const latestRemoteCommit = (await git.revparse([`origin/${application.default_branch}`])).trim();
    const hasUpdate = currentCommit !== latestRemoteCommit;

    upsertUpdateInfoStatement.run(applicationId, currentCommit, latestRemoteCommit, hasUpdate ? 1 : 0, nowIso());

    finishJob(jobId, "succeeded", hasUpdate ? "更新があります。" : "最新状態です。");
    recordEvent({
      scope: "update",
      applicationId,
      level: hasUpdate ? "warning" : "info",
      title: hasUpdate ? "更新があります" : "更新なし",
      message: hasUpdate
        ? `remote=${latestRemoteCommit} / current=${currentCommit}`
        : `最新コミット (${currentCommit}) を確認しました。`
    });

    return c.json({
      jobId,
      hasUpdate,
      currentCommit,
      latestRemoteCommit
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    finishJob(jobId, "failed", message);
    recordEvent({
      scope: "update",
      applicationId,
      level: "error",
      title: "更新確認に失敗しました",
      message
    });
    return c.json({ message: "更新確認に失敗しました。", detail: message, jobId }, 500);
  }
});

applicationsRouter.post("/:applicationId/update", async (c) => {
  const applicationId = c.req.param("applicationId");

  const application = db
    .prepare("SELECT name FROM applications WHERE application_id = ?")
    .get(applicationId) as { name: string } | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  const jobId = createJob("update", applicationId, "更新適用ジョブを作成しました。");
  void executeUpdateJob(applicationId, jobId);

  return c.json(
    {
      jobId,
      message: `${application.name} の更新適用ジョブを開始しました。`
    },
    202
  );
});

applicationsRouter.post("/:applicationId/rollback", async (c) => {
  const applicationId = c.req.param("applicationId");

  const application = db
    .prepare("SELECT name, previous_commit FROM applications WHERE application_id = ?")
    .get(applicationId) as { name: string; previous_commit: string | null } | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  if (!application.previous_commit) {
    return c.json({ message: "ロールバック可能な1つ前のコミットがありません。" }, 400);
  }

  const jobId = createJob("rollback", applicationId, "ロールバックジョブを作成しました。");
  void executeRollbackJob(applicationId, jobId);

  return c.json(
    {
      jobId,
      message: `${application.name} のロールバックジョブを開始しました。`
    },
    202
  );
});

applicationsRouter.delete("/:applicationId", async (c) => {
  const applicationId = c.req.param("applicationId");
  const payload = await c.req.json().catch(() => ({}));

  const parsed = deleteSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ message: "入力値が不正です。", issues: parsed.error.issues }, 400);
  }

  const application = db
    .prepare("SELECT name FROM applications WHERE application_id = ?")
    .get(applicationId) as { name: string } | undefined;

  if (!application) {
    return c.json({ message: "対象アプリが見つかりません。" }, 404);
  }

  const jobId = createJob("delete", applicationId, "削除ジョブを作成しました。");
  void executeDeleteJob(applicationId, jobId, parsed.data.mode);

  return c.json(
    {
      jobId,
      mode: parsed.data.mode,
      message: `${application.name} の削除ジョブを開始しました。`
    },
    202
  );
});
