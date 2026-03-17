import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { db, nowIso } from "../lib/db.js";
import { env } from "../lib/env.js";
import type { JobStatus } from "../types.js";
import { runCommand } from "./command-runner.js";
import { recordEvent } from "./events.js";
import { finishJob, startJob } from "./jobs.js";
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

async function ensureRepository(app: AppDeploymentRow): Promise<{ repoPath: string; headCommit: string }> {
  ensureRuntimeRoots();

  const repoPath = path.join(env.appsRoot, app.name);
  const repoExists = fs.existsSync(path.join(repoPath, ".git"));

  if (!repoExists) {
    if (env.executionMode === "dry-run") {
      fs.mkdirSync(repoPath, { recursive: true });
      return {
        repoPath,
        headCommit: "dry-run"
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
      headCommit: "dry-run"
    };
  }

  const git = simpleGit(repoPath);
  const headCommit = (await git.revparse(["HEAD"])).trim();

  return { repoPath, headCommit };
}

async function runComposeUp(repoPath: string, composeFilePath: string): Promise<void> {
  await runCommand("docker", ["compose", "-f", composeFilePath, "up", "-d", "--build"], { cwd: repoPath });
}

async function runComposeRestart(repoPath: string, composeFilePath: string): Promise<void> {
  await runCommand("docker", ["compose", "-f", composeFilePath, "restart"], { cwd: repoPath });
}

async function runComposeDown(repoPath: string, composeFilePath: string, keepData: boolean): Promise<void> {
  const args = ["compose", "-f", composeFilePath, "down"];
  if (!keepData) {
    args.push("-v");
  }
  await runCommand("docker", args, { cwd: repoPath });
}

function completeJob(jobId: string, status: Extract<JobStatus, "succeeded" | "failed">, message: string): void {
  finishJob(jobId, status, message);
}

export async function executeDeployJob(applicationId: string, jobId: string): Promise<void> {
  const app = getAppDeployment(applicationId);
  startJob(jobId, "deploy ジョブを開始しました。");

  try {
    setAppStatus(applicationId, "Cloning");
    const { repoPath, headCommit } = await ensureRepository(app);

    if (headCommit !== "dry-run") {
      setCommitInfo(applicationId, headCommit);
    }

    setAppStatus(applicationId, "Deploying");
    const composeFilePath = path.resolve(repoPath, app.compose_path);
    await runComposeUp(repoPath, composeFilePath);

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

export async function executeRebuildJob(applicationId: string, jobId: string, keepData: boolean): Promise<void> {
  const app = getAppDeployment(applicationId);
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
    await runComposeDown(repoPath, composeFilePath, keepData);
    await runComposeUp(repoPath, composeFilePath);

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
  startJob(jobId, "restart ジョブを開始しました。");

  try {
    setAppStatus(applicationId, "Deploying");

    const repoPath = path.join(env.appsRoot, app.name);
    if (!fs.existsSync(repoPath)) {
      throw new Error(`アプリソースが見つかりません: ${repoPath}`);
    }

    const composeFilePath = path.resolve(repoPath, app.compose_path);
    await runComposeRestart(repoPath, composeFilePath);

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
  startJob(jobId, "delete ジョブを開始しました。");

  try {
    setAppStatus(applicationId, "Deleting");

    const repoPath = path.join(env.appsRoot, app.name);
    const appDataPath = path.join(env.appDataRoot, app.name);

    if (fs.existsSync(repoPath)) {
      const composeFilePath = path.resolve(repoPath, app.compose_path);
      await runComposeDown(repoPath, composeFilePath, mode !== "full");
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
