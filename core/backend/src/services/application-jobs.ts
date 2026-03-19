import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { db, nowIso } from "../lib/db.js";
import { env } from "../lib/env.js";
import type { JobStatus } from "../types.js";
import { runCommand } from "./command-runner.js";
import { buildComposeProjectName } from "./compose-project.js";
import { recordEvent } from "./events.js";
import { finishJob, setJobProgress, startJob } from "./jobs.js";
import { syncInfrastructure } from "./infrastructure-sync.js";

type AppDeploymentRow = {
  application_id: string;
  name: string;
  repository_url: string;
  default_branch: string;
  compose_path: string;
  public_service_name: string;
  public_port: number;
};

type ComposeServiceInspection = {
  name: string;
  portOptions: number[];
  detectedPublicPort: number | null;
  likelyPublic: boolean;
};

function ensureRuntimeRoots(): void {
  fs.mkdirSync(env.appsRoot, { recursive: true });
  fs.mkdirSync(env.appDataRoot, { recursive: true });
}

function setAppStatus(applicationId: string, status: string): void {
  db.prepare(
    `
      UPDATE applications
      SET status = ?, updated_at = ?
      WHERE application_id = ?
    `
  ).run(status, nowIso(), applicationId);
}

function getAppDeployment(applicationId: string): AppDeploymentRow {
  const row = db
    .prepare(
      `
        SELECT
          a.application_id,
          a.name,
          a.repository_url,
          a.default_branch,
          d.compose_path,
          d.public_service_name,
          d.public_port
        FROM applications a
        INNER JOIN deployments d ON d.application_id = a.application_id
        WHERE a.application_id = ?
      `
    )
    .get(applicationId) as AppDeploymentRow | undefined;

  if (!row) {
    throw new Error("対象アプリの配備情報が見つかりません。");
  }

  return row;
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
      current += char;
      continue;
    }
    if (quote && char === quote) {
      quote = null;
      current += char;
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

function chooseRecommendedComposeService(services: ComposeServiceInspection[]): ComposeServiceInspection | null {
  return services.find((service) => service.likelyPublic && service.detectedPublicPort !== null)
    ?? services.find((service) => service.detectedPublicPort !== null)
    ?? services[0]
    ?? null;
}

function parseComposeServices(content: string): ComposeServiceInspection[] {
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
    const hasNameHint = /web|app|frontend|front|ui|http|nginx|caddy|server/i.test(name);
    const detectedPublicPort = chooseDetectedPort(portOptions);
    const likelyPublic = hasNameHint || (detectedPublicPort !== null && [80, 443, 3000, 8080, 8000, 5173].includes(detectedPublicPort));

    return {
      name,
      portOptions,
      detectedPublicPort,
      likelyPublic
    };
  });
}

function reconcileDeploymentRouting(
  applicationId: string,
  composeFilePath: string,
  configuredServiceName: string,
  configuredPort: number
): { serviceName: string; port: number; corrected: boolean; reason: string } {
  if (!fs.existsSync(composeFilePath)) {
    return {
      serviceName: configuredServiceName,
      port: configuredPort,
      corrected: false,
      reason: "compose ファイルが見つからないため現在設定を維持しました。"
    };
  }

  const content = fs.readFileSync(composeFilePath, "utf8");
  const services = parseComposeServices(content);
  if (services.length === 0) {
    return {
      serviceName: configuredServiceName,
      port: configuredPort,
      corrected: false,
      reason: "compose からサービス候補を検出できなかったため現在設定を維持しました。"
    };
  }

  const configuredService = services.find((service) => service.name === configuredServiceName);
  let resolvedServiceName = configuredServiceName;
  let resolvedPort = configuredPort;

  if (!configuredService) {
    const recommendedService = chooseRecommendedComposeService(services);
    if (recommendedService) {
      resolvedServiceName = recommendedService.name;
      resolvedPort = recommendedService.detectedPublicPort ?? recommendedService.portOptions[0] ?? configuredPort;
    }
  } else if (!configuredService.portOptions.includes(configuredPort)) {
    resolvedPort = configuredService.detectedPublicPort ?? configuredService.portOptions[0] ?? configuredPort;
  }

  const corrected = resolvedServiceName !== configuredServiceName || resolvedPort !== configuredPort;
  if (corrected) {
    db.prepare(
      `
        UPDATE deployments
        SET public_service_name = ?, public_port = ?
        WHERE application_id = ?
      `
    ).run(resolvedServiceName, resolvedPort, applicationId);

    db.prepare(
      `
        UPDATE routes
        SET upstream_container = ?, upstream_port = ?
        WHERE application_id = ?
      `
    ).run(resolvedServiceName, resolvedPort, applicationId);
  }

  return {
    serviceName: resolvedServiceName,
    port: resolvedPort,
    corrected,
    reason: corrected
      ? `compose 実体に合わせて公開先を ${resolvedServiceName}:${resolvedPort} に補正しました。`
      : "compose 実体と公開設定は一致していました。"
  };
}

function setCommitInfo(applicationId: string, commitHash: string): void {
  db.prepare(
    `
      UPDATE applications
      SET previous_commit = current_commit,
          current_commit = ?,
          updated_at = ?
      WHERE application_id = ?
    `
  ).run(commitHash, nowIso(), applicationId);

  db.prepare(
    `
      INSERT INTO update_info (
        application_id,
        current_commit,
        latest_remote_commit,
        has_update,
        checked_at
      ) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(application_id) DO UPDATE SET
        current_commit = excluded.current_commit,
        latest_remote_commit = excluded.latest_remote_commit,
        has_update = 0,
        checked_at = excluded.checked_at
    `
  ).run(applicationId, commitHash, commitHash, nowIso());
}

function upsertUpdateInfo(applicationId: string, currentCommit: string, latestRemoteCommit: string, hasUpdate: boolean): void {
  db.prepare(
    `
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
    `
  ).run(applicationId, currentCommit, latestRemoteCommit, hasUpdate ? 1 : 0, nowIso());
}

function getCommitInfo(applicationId: string): { currentCommit: string | null; previousCommit: string | null } {
  const row = db
    .prepare(
      `
        SELECT current_commit, previous_commit
        FROM applications
        WHERE application_id = ?
      `
    )
    .get(applicationId) as { current_commit: string | null; previous_commit: string | null } | undefined;

  if (!row) {
    throw new Error("対象アプリが見つかりません。");
  }

  return {
    currentCommit: row.current_commit,
    previousCommit: row.previous_commit
  };
}

function setCommitPair(applicationId: string, currentCommit: string, previousCommit: string | null): void {
  db.prepare(
    `
      UPDATE applications
      SET current_commit = ?,
          previous_commit = ?,
          updated_at = ?
      WHERE application_id = ?
    `
  ).run(currentCommit, previousCommit, nowIso(), applicationId);
}

function dryRunCommit(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

async function ensureRepository(app: AppDeploymentRow): Promise<{ repoPath: string; headCommit: string }> {
  ensureRuntimeRoots();

  const repoPath = path.join(env.appsRoot, app.name);
  const repoExists = fs.existsSync(path.join(repoPath, ".git"));

  if (!repoExists) {
    if (env.executionMode === "dry-run") {
      fs.mkdirSync(repoPath, { recursive: true });
      return {
        repoPath,
        headCommit: dryRunCommit("dry-run")
      };
    }

    await simpleGit(env.appsRoot).clone(app.repository_url, app.name, ["--branch", app.default_branch, "--single-branch"]);
  } else {
    const git = simpleGit(repoPath);
    await git.fetch();
    await git.checkout(app.default_branch);
    await git.pull("origin", app.default_branch);
  }

  if (env.executionMode === "dry-run") {
    return {
      repoPath,
      headCommit: dryRunCommit("dry-run")
    };
  }

  const git = simpleGit(repoPath);
  const headCommit = (await git.revparse(["HEAD"])).trim();

  return { repoPath, headCommit };
}

async function runComposeUp(repoPath: string, composeFilePath: string, composeProjectName: string): Promise<void> {
  await runCommand("docker", ["compose", "-p", composeProjectName, "-f", composeFilePath, "up", "-d", "--build"], {
    cwd: repoPath
  });
}

async function runComposeRestart(repoPath: string, composeFilePath: string, composeProjectName: string): Promise<void> {
  await runCommand("docker", ["compose", "-p", composeProjectName, "-f", composeFilePath, "restart"], { cwd: repoPath });
}

async function runComposeDown(
  repoPath: string,
  composeFilePath: string,
  composeProjectName: string,
  keepData: boolean
): Promise<void> {
  const args = ["compose", "-p", composeProjectName, "-f", composeFilePath, "down"];
  if (!keepData) {
    args.push("-v");
  }
  await runCommand("docker", args, { cwd: repoPath });
}

function completeJob(jobId: string, status: Extract<JobStatus, "succeeded" | "failed">, message: string): void {
  finishJob(jobId, status, message);
}

function recordDeployProgress(applicationId: string, title: string, message: string): void {
  recordEvent({
    scope: "deployment",
    applicationId,
    level: "info",
    title,
    message
  });
}

export async function executeDeployJob(applicationId: string, jobId: string): Promise<void> {
  const app = getAppDeployment(applicationId);
  const composeProjectName = buildComposeProjectName(app.application_id, app.name);
  startJob(jobId, "deploy ジョブを開始しました。");

  try {
    setAppStatus(applicationId, "Cloning");
    setJobProgress(jobId, "GitHub リポジトリを取得しています。");
    recordDeployProgress(applicationId, "リポジトリ取得を開始しました", `${app.repository_url} (${app.default_branch}) を取得しています。`);
    const { repoPath, headCommit } = await ensureRepository(app);
    setCommitInfo(applicationId, headCommit);

    setAppStatus(applicationId, "Deploying");
    setJobProgress(jobId, `リポジトリ取得完了。commit ${headCommit.slice(0, 12)} を配備準備中です。`);
    recordDeployProgress(applicationId, "リポジトリ取得が完了しました", `commit ${headCommit} を取得しました。`);
    const composeFilePath = path.resolve(repoPath, app.compose_path);
    setJobProgress(jobId, `docker compose を起動しています。compose=${app.compose_path}`);
    recordDeployProgress(
      applicationId,
      "コンテナを起動しています",
      `docker compose -p ${composeProjectName} -f ${composeFilePath} up -d --build を実行しています。`
    );
    await runComposeUp(repoPath, composeFilePath, composeProjectName);
    const routing = reconcileDeploymentRouting(applicationId, composeFilePath, app.public_service_name, app.public_port);
    if (routing.corrected) {
      recordEvent({
        scope: "deployment",
        applicationId,
        level: "warning",
        title: "公開先設定を補正しました",
        message: routing.reason
      });
    }

    setJobProgress(jobId, "公開ルートとインフラ設定を同期しています。");
    recordDeployProgress(applicationId, "公開設定を同期しています", `アプリ ${app.name} の DNS / Proxy 設定を反映しています。`);
    setAppStatus(applicationId, "Running");
    syncInfrastructure(`deploy:${app.name}`);

    completeJob(jobId, "succeeded", `deploy 完了 (${env.executionMode})`);
    recordEvent({
      scope: "deployment",
      applicationId,
      level: "info",
      title: "配備が完了しました",
      message: `アプリ ${app.name} を配備しました。mode=${env.executionMode}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    setAppStatus(applicationId, "Failed");
    completeJob(jobId, "failed", message);
    recordEvent({
      scope: "deployment",
      applicationId,
      level: "error",
      title: "配備に失敗しました",
      message
    });
  }
}

export async function executeUpdateJob(applicationId: string, jobId: string): Promise<void> {
  const app = getAppDeployment(applicationId);
  const composeProjectName = buildComposeProjectName(app.application_id, app.name);
  startJob(jobId, "update ジョブを開始しました。");

  try {
    setAppStatus(applicationId, "Deploying");
    const commitInfo = getCommitInfo(applicationId);
    const repoPath = path.join(env.appsRoot, app.name);

    if (env.executionMode === "dry-run") {
      const current = commitInfo.currentCommit ?? dryRunCommit("dry-run-base");
      const latest = dryRunCommit("dry-run-update");
      setCommitPair(applicationId, latest, current);
      upsertUpdateInfo(applicationId, latest, latest, false);
      setAppStatus(applicationId, "Running");
      completeJob(jobId, "succeeded", "update 完了 (dry-run)");
      recordEvent({
        scope: "update",
        applicationId,
        level: "info",
        title: "更新を適用しました",
        message: `アプリ ${app.name} を dry-run 更新しました。`
      });
      return;
    }

    if (!fs.existsSync(path.join(repoPath, ".git"))) {
      throw new Error(`ローカルリポジトリが見つかりません: ${repoPath}`);
    }

    const git = simpleGit(repoPath);
    const beforeCommit = (await git.revparse(["HEAD"])).trim();
    await git.fetch();
    await git.checkout(app.default_branch);
    await git.pull("origin", app.default_branch);
    const afterCommit = (await git.revparse(["HEAD"])).trim();

    const composeFilePath = path.resolve(repoPath, app.compose_path);
    await runComposeUp(repoPath, composeFilePath, composeProjectName);
    const routing = reconcileDeploymentRouting(applicationId, composeFilePath, app.public_service_name, app.public_port);
    if (routing.corrected) {
      recordEvent({
        scope: "update",
        applicationId,
        level: "warning",
        title: "公開先設定を補正しました",
        message: routing.reason
      });
    }

    setCommitPair(applicationId, afterCommit, beforeCommit);
    upsertUpdateInfo(applicationId, afterCommit, afterCommit, false);
    setAppStatus(applicationId, "Running");
    syncInfrastructure(`update:${app.name}`);

    const unchanged = beforeCommit === afterCommit;
    completeJob(jobId, "succeeded", unchanged ? "update 完了（差分なし）" : "update 完了");
    recordEvent({
      scope: "update",
      applicationId,
      level: unchanged ? "info" : "warning",
      title: unchanged ? "更新差分なし" : "更新を適用しました",
      message: unchanged
        ? `アプリ ${app.name} は最新でした。`
        : `アプリ ${app.name} を ${beforeCommit.slice(0, 7)} -> ${afterCommit.slice(0, 7)} に更新しました。`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    setAppStatus(applicationId, "Failed");
    completeJob(jobId, "failed", message);
    recordEvent({
      scope: "update",
      applicationId,
      level: "error",
      title: "更新に失敗しました",
      message
    });
  }
}

export async function executeRollbackJob(applicationId: string, jobId: string): Promise<void> {
  const app = getAppDeployment(applicationId);
  const composeProjectName = buildComposeProjectName(app.application_id, app.name);
  startJob(jobId, "rollback ジョブを開始しました。");

  try {
    setAppStatus(applicationId, "Rebuilding");
    const commitInfo = getCommitInfo(applicationId);
    const currentCommit = commitInfo.currentCommit;
    const rollbackTarget = commitInfo.previousCommit;

    if (!rollbackTarget) {
      throw new Error("ロールバック可能な1つ前のコミットがありません。");
    }

    if (env.executionMode === "dry-run") {
      const nextPrevious = currentCommit ?? dryRunCommit("dry-run-current");
      setCommitPair(applicationId, rollbackTarget, nextPrevious);
      upsertUpdateInfo(applicationId, rollbackTarget, nextPrevious, rollbackTarget !== nextPrevious);
      setAppStatus(applicationId, "Running");
      completeJob(jobId, "succeeded", "rollback 完了 (dry-run)");
      recordEvent({
        scope: "update",
        applicationId,
        level: "warning",
        title: "1世代ロールバックしました",
        message: `アプリ ${app.name} を dry-run ロールバックしました。`
      });
      return;
    }

    const repoPath = path.join(env.appsRoot, app.name);
    if (!fs.existsSync(path.join(repoPath, ".git"))) {
      throw new Error(`ローカルリポジトリが見つかりません: ${repoPath}`);
    }

    const git = simpleGit(repoPath);
    await git.fetch();
    await git.checkout(rollbackTarget);

    const composeFilePath = path.resolve(repoPath, app.compose_path);
    await runComposeUp(repoPath, composeFilePath, composeProjectName);
    const routing = reconcileDeploymentRouting(applicationId, composeFilePath, app.public_service_name, app.public_port);
    if (routing.corrected) {
      recordEvent({
        scope: "update",
        applicationId,
        level: "warning",
        title: "公開先設定を補正しました",
        message: routing.reason
      });
    }

    const remoteHead = (await git.revparse([`origin/${app.default_branch}`])).trim();
    const nextPrevious = currentCommit ?? remoteHead;

    setCommitPair(applicationId, rollbackTarget, nextPrevious);
    upsertUpdateInfo(applicationId, rollbackTarget, remoteHead, rollbackTarget !== remoteHead);
    setAppStatus(applicationId, "Running");
    syncInfrastructure(`rollback:${app.name}`);

    completeJob(jobId, "succeeded", "rollback 完了");
    recordEvent({
      scope: "update",
      applicationId,
      level: "warning",
      title: "1世代ロールバックしました",
      message: `アプリ ${app.name} を ${rollbackTarget.slice(0, 7)} に戻しました。`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    setAppStatus(applicationId, "Failed");
    completeJob(jobId, "failed", message);
    recordEvent({
      scope: "update",
      applicationId,
      level: "error",
      title: "ロールバックに失敗しました",
      message
    });
  }
}

export async function executeRebuildJob(applicationId: string, jobId: string, keepData: boolean): Promise<void> {
  const app = getAppDeployment(applicationId);
  const composeProjectName = buildComposeProjectName(app.application_id, app.name);
  startJob(jobId, "rebuild ジョブを開始しました。");

  try {
    setAppStatus(applicationId, "Rebuilding");
    const repoPath = path.join(env.appsRoot, app.name);

    if (!fs.existsSync(repoPath)) {
      throw new Error(`アプリソースが見つかりません: ${repoPath}`);
    }

    db.prepare(
      `
        UPDATE deployments
        SET keep_volumes_on_rebuild = ?
        WHERE application_id = ?
      `
    ).run(keepData ? 1 : 0, applicationId);

    const composeFilePath = path.resolve(repoPath, app.compose_path);
    await runComposeDown(repoPath, composeFilePath, composeProjectName, keepData);
    await runComposeUp(repoPath, composeFilePath, composeProjectName);
    const routing = reconcileDeploymentRouting(applicationId, composeFilePath, app.public_service_name, app.public_port);
    if (routing.corrected) {
      recordEvent({
        scope: "runtime",
        applicationId,
        level: "warning",
        title: "公開先設定を補正しました",
        message: routing.reason
      });
    }

    setAppStatus(applicationId, "Running");
    syncInfrastructure(`rebuild:${app.name}`);

    completeJob(jobId, "succeeded", `rebuild 完了 keepData=${keepData}`);
    recordEvent({
      scope: "runtime",
      applicationId,
      level: keepData ? "info" : "warning",
      title: "再ビルドが完了しました",
      message: `アプリ ${app.name} を keepData=${keepData} で再ビルドしました。`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    setAppStatus(applicationId, "Failed");
    completeJob(jobId, "failed", message);
    recordEvent({
      scope: "runtime",
      applicationId,
      level: "error",
      title: "再ビルドに失敗しました",
      message
    });
  }
}

export async function executeRestartJob(applicationId: string, jobId: string): Promise<void> {
  const app = getAppDeployment(applicationId);
  const composeProjectName = buildComposeProjectName(app.application_id, app.name);
  startJob(jobId, "restart ジョブを開始しました。");

  try {
    setAppStatus(applicationId, "Deploying");

    const repoPath = path.join(env.appsRoot, app.name);
    if (!fs.existsSync(repoPath)) {
      throw new Error(`アプリソースが見つかりません: ${repoPath}`);
    }

    const composeFilePath = path.resolve(repoPath, app.compose_path);
    await runComposeRestart(repoPath, composeFilePath, composeProjectName);

    setAppStatus(applicationId, "Running");
    completeJob(jobId, "succeeded", "restart 完了");

    recordEvent({
      scope: "runtime",
      applicationId,
      level: "info",
      title: "再起動が完了しました",
      message: `アプリ ${app.name} を再起動しました。mode=${env.executionMode}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    setAppStatus(applicationId, "Failed");
    completeJob(jobId, "failed", message);

    recordEvent({
      scope: "runtime",
      applicationId,
      level: "error",
      title: "再起動に失敗しました",
      message
    });
  }
}

type DeleteMode = "config_only" | "source_and_config" | "full";

export async function executeDeleteJob(applicationId: string, jobId: string, mode: DeleteMode): Promise<void> {
  const app = getAppDeployment(applicationId);
  const composeProjectName = buildComposeProjectName(app.application_id, app.name);
  startJob(jobId, "delete ジョブを開始しました。");

  try {
    setAppStatus(applicationId, "Deleting");

    const repoPath = path.join(env.appsRoot, app.name);
    const appDataPath = path.join(env.appDataRoot, app.name);

    if (fs.existsSync(repoPath)) {
      const composeFilePath = path.resolve(repoPath, app.compose_path);
      await runComposeDown(repoPath, composeFilePath, composeProjectName, mode !== "full");
    }

    if (mode === "source_and_config" || mode === "full") {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }

    if (mode === "full") {
      fs.rmSync(appDataPath, { recursive: true, force: true });
    }

    db.prepare("DELETE FROM applications WHERE application_id = ?").run(applicationId);
    syncInfrastructure(`delete:${app.name}`);

    completeJob(jobId, "succeeded", `delete 完了 mode=${mode}`);

    recordEvent({
      scope: "application",
      level: "warning",
      title: "アプリを削除しました",
      message: `アプリ ${app.name} を mode=${mode} で削除しました。`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    const exists = db
      .prepare("SELECT application_id FROM applications WHERE application_id = ?")
      .get(applicationId) as { application_id: string } | undefined;

    if (exists) {
      setAppStatus(applicationId, "Failed");
    }

    completeJob(jobId, "failed", message);

    recordEvent({
      scope: "application",
      applicationId: exists ? applicationId : undefined,
      level: "error",
      title: "削除に失敗しました",
      message
    });
  }
}
