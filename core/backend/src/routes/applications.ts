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
          u.checked_at
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
  const applicationId = nanoid();
  const deploymentId = nanoid();
  const routeId = nanoid();
  const createdAt = nowIso();

  const tx = db.transaction(() => {
    insertApplicationStatement.run(
      applicationId,
      data.name,
      data.description,
      data.repositoryUrl,
      data.defaultBranch,
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
