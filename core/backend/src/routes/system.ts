import { Hono } from "hono";
import { db, nowIso } from "../lib/db.js";
import { env } from "../lib/env.js";
import { dnsServer } from "../services/dns-server.js";

export const systemRouter = new Hono();

systemRouter.get("/status", (c) => {
  const totalApps = Number(
    (db.prepare("SELECT COUNT(*) as count FROM applications").get() as { count: number } | undefined)?.count ?? 0
  );
  const runningApps = Number(
    (
      db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Running'").get() as
        | { count: number }
        | undefined
    )?.count ?? 0
  );
  const degradedApps = Number(
    (
      db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Degraded'").get() as
        | { count: number }
        | undefined
    )?.count ?? 0
  );
  const failedApps = Number(
    (
      db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Failed'").get() as
        | { count: number }
        | undefined
    )?.count ?? 0
  );

  const queuedJobs = Number(
    (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'queued'").get() as { count: number } | undefined)
      ?.count ?? 0
  );
  const runningJobs = Number(
    (
      db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").get() as
        | { count: number }
        | undefined
    )?.count ?? 0
  );

  return c.json({
    generatedAt: nowIso(),
    applicationSummary: {
      total: totalApps,
      running: runningApps,
      degraded: degradedApps,
      failed: failedApps
    },
    jobSummary: {
      queued: queuedJobs,
      running: runningJobs
    },
    paths: {
      dbPath: env.dbPath,
      appsRoot: env.appsRoot,
      appDataRoot: env.appDataRoot,
      generatedProxyConfigPath: env.generatedProxyConfigPath,
      generatedDnsHostsPath: env.generatedDnsHostsPath
    },
    execution: {
      mode: env.executionMode,
      mainServiceIp: env.mainServiceIp,
      sshServiceIp: env.sshServiceIp,
      rootDomain: env.rootDomain
    },
    dnsServer: dnsServer.getStatus()
  });
});
