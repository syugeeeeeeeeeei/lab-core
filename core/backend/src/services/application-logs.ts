import fs from "node:fs";
import path from "node:path";
import { db, nowIso } from "../lib/db.js";
import { env } from "../lib/env.js";
import { runCommand } from "./command-runner.js";

type AppDeploymentRow = {
  application_id: string;
  name: string;
  compose_path: string;
  public_service_name: string;
};

type EventRow = {
  created_at: string;
  level: string;
  title: string;
  message: string;
};

export type ApplicationLogSnapshot = {
  applicationId: string;
  applicationName: string;
  service: string | null;
  tail: number;
  lines: string[];
  fetchedAt: string;
  executionMode: "dry-run" | "execute";
};

function getAppDeployment(applicationId: string): AppDeploymentRow {
  const row = db
    .prepare(
      `
        SELECT
          a.application_id,
          a.name,
          d.compose_path,
          d.public_service_name
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

function formatDryRunEventLine(event: EventRow): string {
  return `[${event.created_at}] [${event.level}] ${event.title} - ${event.message}`;
}

function parseServiceListFromComposeConfig(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseLogLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0);
}

export async function listApplicationServices(applicationId: string): Promise<string[]> {
  const app = getAppDeployment(applicationId);
  const repoPath = path.join(env.appsRoot, app.name);

  const servicesFromDb = db
    .prepare(
      `
        SELECT DISTINCT service_name
        FROM container_instances
        WHERE application_id = ?
        ORDER BY service_name ASC
      `
    )
    .all(applicationId) as Array<{ service_name: string }>;

  const dbServices = servicesFromDb.map((row) => row.service_name).filter((value) => value.length > 0);
  const mergedDefaults = Array.from(new Set([app.public_service_name, ...dbServices])).filter((value) => value.length > 0);

  if (env.executionMode === "dry-run") {
    return mergedDefaults;
  }

  if (!fs.existsSync(repoPath)) {
    return mergedDefaults;
  }

  const composeFilePath = path.resolve(repoPath, app.compose_path);
  if (!fs.existsSync(composeFilePath)) {
    return mergedDefaults;
  }

  try {
    const result = await runCommand("docker", ["compose", "-f", composeFilePath, "config", "--services"], { cwd: repoPath });
    const discovered = parseServiceListFromComposeConfig(result.stdout);
    return Array.from(new Set([...discovered, ...mergedDefaults]));
  } catch {
    return mergedDefaults;
  }
}

export async function readApplicationLogs(
  applicationId: string,
  options: { service?: string; tail: number }
): Promise<ApplicationLogSnapshot> {
  const app = getAppDeployment(applicationId);
  const repoPath = path.join(env.appsRoot, app.name);

  if (env.executionMode === "dry-run") {
    const events = db
      .prepare(
        `
          SELECT created_at, level, title, message
          FROM system_events
          WHERE application_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(applicationId, options.tail) as EventRow[];

    const lines = events.map((event) => formatDryRunEventLine(event)).reverse();
    const fallback =
      lines.length > 0
        ? lines
        : ["[dry-run] コンテナログは生成されません。execute モードでの確認時に実ログが表示されます。"];

    return {
      applicationId: app.application_id,
      applicationName: app.name,
      service: options.service ?? null,
      tail: options.tail,
      lines: fallback,
      fetchedAt: nowIso(),
      executionMode: env.executionMode
    };
  }

  if (!fs.existsSync(repoPath)) {
    throw new Error(`アプリソースが見つかりません: ${repoPath}`);
  }

  const composeFilePath = path.resolve(repoPath, app.compose_path);
  if (!fs.existsSync(composeFilePath)) {
    throw new Error(`compose ファイルが見つかりません: ${composeFilePath}`);
  }

  const args = ["compose", "-f", composeFilePath, "logs", "--no-color", "--tail", String(options.tail)];
  if (options.service) {
    args.push(options.service);
  }

  const result = await runCommand("docker", args, { cwd: repoPath });
  const lines = parseLogLines(result.stdout);

  return {
    applicationId: app.application_id,
    applicationName: app.name,
    service: options.service ?? null,
    tail: options.tail,
    lines,
    fetchedAt: nowIso(),
    executionMode: env.executionMode
  };
}
