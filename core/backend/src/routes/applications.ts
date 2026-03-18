import fs from "node:fs";
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
  executeRestartJob,
  executeRollbackJob,
  executeUpdateJob
} from "../services/application-jobs.js";
import { recordEvent } from "../services/events.js";
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
  deviceRequirements: z.array(z.string().min(1)).optional().default([])
});

const resolveImportSchema = z.object({
  sourceUrl: z.string().url()
});

const inspectComposeSchema = z.object({
  repositoryUrl: z.string().url(),
  branch: z.string().min(1).max(120),
  composePath: z.string().min(1).max(400)
});

const rebuildSchema = z.object({
  keepData: z.boolean().optional().default(true)
});

const deleteSchema = z.object({
  mode: z.enum(["config_only", "source_and_config", "full"]).optional().default("config_only")
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
    enabled
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

type ComposeServiceCandidate = {
  name: string;
  portOptions: number[];
  publishedPorts: number[];
  exposePorts: number[];
  detectedPublicPort: number | null;
  likelyPublic: boolean;
  reason: string;
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

async function fetchBlobContent(blobUrl: string): Promise<string> {
  const blob = await fetchGithubJson<GithubBlobResponse>(blobUrl);
  if (blob.encoding !== "base64") {
    throw new Error(`未対応の blob encoding です: ${blob.encoding}`);
  }
  return Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
}

function isYamlFile(pathValue: string): boolean {
  return /\.ya?ml$/i.test(pathValue);
}

function composeCandidateScore(pathValue: string): number {
  const normalized = pathValue.toLowerCase();
  const basename = normalized.split("/").pop() ?? normalized;
  let score = 0;

  if (normalized.startsWith("docker-compose.")) {
    score += 50;
  }
  if (normalized.startsWith("compose.")) {
    score += 45;
  }
  if (basename === "docker-compose.yml" || basename === "docker-compose.yaml") {
    score += 40;
  }
  if (basename === "compose.yml" || basename === "compose.yaml") {
    score += 35;
  }
  if (basename.includes("compose")) {
    score += 20;
  }
  if (!normalized.includes("/")) {
    score += 15;
  }

  return score;
}

function parseInlineList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }

  const inner = trimmed.slice(1, -1);
  const items: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of inner) {
    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }
    if (quote && char === quote) {
      quote = null;
      continue;
    }
    if (char === "," && quote === null) {
      if (current.trim().length > 0) {
        items.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim().length > 0) {
    items.push(current.trim());
  }

  return items.map((item) => item.trim().replace(/^['"]|['"]$/g, ""));
}

function stripYamlComment(line: string): string {
  let result = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      result += char;
      continue;
    }
    if (quote && char === quote) {
      quote = null;
      result += char;
      continue;
    }
    if (char === "#" && quote === null) {
      break;
    }
    result += char;
  }

  return result.trimEnd();
}

function parseServiceKey(value: string): string | null {
  const match = value.match(/^["']?([^"':]+)["']?:\s*$/);
  return match ? match[1].trim() : null;
}

function parsePortNumber(value: string): number | null {
  const match = value.match(/(\d+)/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseShortPortMapping(value: string): { target: number | null; published: number | null } {
  const normalized = value.trim().replace(/^['"]|['"]$/g, "").replace(/\/(tcp|udp)$/i, "");
  if (normalized.length === 0) {
    return { target: null, published: null };
  }

  const directPort = parsePortNumber(normalized);
  if (!normalized.includes(":")) {
    return { target: directPort, published: null };
  }

  const segments = normalized.split(":");
  const target = parsePortNumber(segments[segments.length - 1] ?? "");
  let published: number | null = null;

  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const parsed = parsePortNumber(segments[index] ?? "");
    if (parsed !== null) {
      published = parsed;
      break;
    }
  }

  return { target, published };
}

function chooseDetectedPort(portOptions: number[]): number | null {
  const preferred = [80, 443, 3000, 8080, 8000, 5173, 4173, 5000, 8501, 8888];
  for (const port of preferred) {
    if (portOptions.includes(port)) {
      return port;
    }
  }
  return portOptions[0] ?? null;
}

function buildServiceReason(name: string, portOptions: number[], likelyPublic: boolean): string {
  if (portOptions.length === 0) {
    return "ports / expose から公開候補ポートを検出できませんでした。";
  }
  if (likelyPublic) {
    return `サービス名 (${name}) と公開候補ポートから Web 公開候補と判断しました。`;
  }
  return "ports / expose から候補ポートを検出しました。";
}

function parseComposeServices(content: string): ComposeServiceCandidate[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const services = new Map<string, { targetPorts: Set<number>; publishedPorts: Set<number>; exposePorts: Set<number> }>();

  let inServices = false;
  let servicesIndent = -1;
  let currentService: string | null = null;
  let currentServiceIndent = -1;
  let currentSection: "ports" | "expose" | null = null;
  let currentPortMap: { target: number | null; published: number | null } | null = null;
  let currentPortItemIndent = -1;

  function ensureService(name: string) {
    if (!services.has(name)) {
      services.set(name, {
        targetPorts: new Set<number>(),
        publishedPorts: new Set<number>(),
        exposePorts: new Set<number>()
      });
    }
    return services.get(name)!;
  }

  function finalizePortMap(): void {
    if (!currentService || !currentPortMap) {
      return;
    }
    const service = ensureService(currentService);
    if (currentPortMap.target !== null) {
      service.targetPorts.add(currentPortMap.target);
    }
    if (currentPortMap.published !== null) {
      service.publishedPorts.add(currentPortMap.published);
    }
    currentPortMap = null;
    currentPortItemIndent = -1;
  }

  for (const rawLine of lines) {
    const line = stripYamlComment(rawLine.replace(/\t/g, "  "));
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const indent = line.length - line.trimStart().length;

    if (!inServices) {
      if (trimmed === "services:") {
        inServices = true;
        servicesIndent = indent;
      }
      continue;
    }

    if (indent <= servicesIndent) {
      finalizePortMap();
      break;
    }

    if (currentPortMap && indent <= currentPortItemIndent) {
      finalizePortMap();
    }

    const serviceKey = !trimmed.startsWith("- ") ? parseServiceKey(trimmed) : null;
    if (serviceKey && indent > servicesIndent && (currentService === null || indent <= currentServiceIndent)) {
      finalizePortMap();
      currentService = serviceKey;
      currentServiceIndent = indent;
      currentSection = null;
      ensureService(serviceKey);
      continue;
    }

    if (!currentService) {
      continue;
    }

    if (indent <= currentServiceIndent) {
      finalizePortMap();
      currentService = null;
      currentSection = null;
      continue;
    }

    if (!currentPortMap && !trimmed.startsWith("- ") && indent > currentServiceIndent) {
      const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (!keyMatch) {
        currentSection = null;
        continue;
      }

      const [, key, value] = keyMatch;
      if (key !== "ports" && key !== "expose") {
        currentSection = null;
        continue;
      }

      currentSection = key;
      const normalizedValue = value.trim();
      const service = ensureService(currentService);
      if (normalizedValue.length > 0) {
        const inlineValues = parseInlineList(normalizedValue);
        const values = inlineValues.length > 0 ? inlineValues : [normalizedValue];
        for (const entry of values) {
          if (currentSection === "ports") {
            const parsedPort = parseShortPortMapping(entry);
            if (parsedPort.target !== null) {
              service.targetPorts.add(parsedPort.target);
            }
            if (parsedPort.published !== null) {
              service.publishedPorts.add(parsedPort.published);
            }
          } else {
            const exposePort = parsePortNumber(entry);
            if (exposePort !== null) {
              service.exposePorts.add(exposePort);
            }
          }
        }
      }
      continue;
    }

    if (!currentSection || indent <= currentServiceIndent) {
      continue;
    }

    const service = ensureService(currentService);

    if (trimmed.startsWith("- ")) {
      finalizePortMap();
      const itemValue = trimmed.slice(2).trim();
      if (currentSection === "ports") {
        if (/^(target|published|protocol|host_ip|mode):/.test(itemValue) || itemValue.length === 0) {
          currentPortMap = { target: null, published: null };
          currentPortItemIndent = indent;
          if (itemValue.length > 0) {
            const [rawKey, rawValue] = itemValue.split(":", 2);
            const mapValue = parsePortNumber(rawValue ?? "");
            if (rawKey.trim() === "target") {
              currentPortMap.target = mapValue;
            }
            if (rawKey.trim() === "published") {
              currentPortMap.published = mapValue;
            }
          }
        } else {
          const parsedPort = parseShortPortMapping(itemValue);
          if (parsedPort.target !== null) {
            service.targetPorts.add(parsedPort.target);
          }
          if (parsedPort.published !== null) {
            service.publishedPorts.add(parsedPort.published);
          }
        }
      } else {
        const exposePort = parsePortNumber(itemValue);
        if (exposePort !== null) {
          service.exposePorts.add(exposePort);
        }
      }
      continue;
    }

    if (currentSection === "ports" && currentPortMap) {
      const [rawKey, rawValue] = trimmed.split(":", 2);
      const mapValue = parsePortNumber(rawValue ?? "");
      if (rawKey.trim() === "target") {
        currentPortMap.target = mapValue;
      }
      if (rawKey.trim() === "published") {
        currentPortMap.published = mapValue;
      }
    }
  }

  finalizePortMap();

  return [...services.entries()].map(([name, service]) => {
    const portOptions = [...new Set([...service.targetPorts, ...service.exposePorts])].sort((a, b) => a - b);
    const publishedPorts = [...service.publishedPorts].sort((a, b) => a - b);
    const exposePorts = [...service.exposePorts].sort((a, b) => a - b);
    const hasNameHint = /web|app|frontend|front|ui|http|nginx|caddy|server/i.test(name);
    const detectedPublicPort = chooseDetectedPort(portOptions);
    const likelyPublic = hasNameHint || (detectedPublicPort !== null && [80, 443, 3000, 8080, 8000, 5173].includes(detectedPublicPort));

    return {
      name,
      portOptions,
      publishedPorts,
      exposePorts,
      detectedPublicPort,
      likelyPublic,
      reason: buildServiceReason(name, portOptions, likelyPublic)
    };
  });
}

function collectRepositoryMetadata(entries: GithubTreeEntry[]): {
  repositoryFiles: string[];
  yamlFiles: string[];
  composeCandidates: string[];
  recommendedComposePath: string | null;
} {
  const repositoryFiles = [...new Set(entries.map((entry) => entry.path))].sort((a, b) => a.localeCompare(b));
  const yamlFiles = [...new Set(repositoryFiles.filter((filePath) => isYamlFile(filePath)))];
  const composeCandidates = [...new Set(yamlFiles.filter((filePath) => composeCandidateScore(filePath) > 0))].sort((a, b) => {
    const scoreDiff = composeCandidateScore(b) - composeCandidateScore(a);
    return scoreDiff !== 0 ? scoreDiff : a.localeCompare(b);
  });

  return {
    repositoryFiles,
    yamlFiles,
    composeCandidates,
    recommendedComposePath: composeCandidates[0] ?? null
  };
}

async function inspectComposeFromRepository(
  repositoryUrl: string,
  branch: string,
  composePath: string
): Promise<{ composePath: string; services: ComposeServiceCandidate[] }> {
  const entries = await fetchRepositoryTree(repositoryUrl, branch);
  const normalizedPath = composePath.trim().replace(/^\/+/, "");
  const matchedEntry = entries.find((entry) => entry.path === normalizedPath);

  if (!matchedEntry) {
    throw new Error(`compose ファイルが見つかりません: ${normalizedPath}`);
  }

  const content = await fetchBlobContent(matchedEntry.url);
  const services = parseComposeServices(content);

  return {
    composePath: normalizedPath,
    services: services.sort((a, b) => {
      if (a.likelyPublic !== b.likelyPublic) {
        return a.likelyPublic ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    })
  };
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
    const entries = await fetchRepositoryTree(parsedSource.canonicalRepositoryUrl, resolvedBranch);
    const metadata = collectRepositoryMetadata(entries);
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

  let normalizedImportInput: { repositoryUrl: string; defaultBranch: string };
  try {
    normalizedImportInput = normalizeCreateImportInput(parsedPayload.data.repositoryUrl, parsedPayload.data.branch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub URL の解釈に失敗しました。";
    return c.json({ message }, 400);
  }

  try {
    const inspection = await inspectComposeFromRepository(
      normalizedImportInput.repositoryUrl,
      normalizedImportInput.defaultBranch,
      parsedPayload.data.composePath
    );
    return c.json(inspection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "compose 解析に失敗しました。";
    return c.json({ message }, 400);
  }
});

applicationsRouter.get("/:applicationId", (c) => {
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
          enabled
        FROM deployments
        WHERE application_id = ?
      `
    )
    .get(applicationId) as Record<string, unknown> | undefined;

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
        device_requirements: parseJsonSafely(String(deployment.device_requirements ?? "[]"))
      }
    : null;

  const normalizedRoutes = (routes as Array<Record<string, unknown>>).map((route) => ({
    ...route,
    enabled: Boolean(route.enabled)
  }));

  return c.json({
    application,
    deployment: normalizedDeployment,
    routes: normalizedRoutes,
    containers,
    updateInfo: updateInfo ? { ...updateInfo, has_update: Boolean((updateInfo as Record<string, unknown>).has_update) } : null,
    events
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
