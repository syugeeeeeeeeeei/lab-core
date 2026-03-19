import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { db, nowIso } from "./lib/db.js";
import { env } from "./lib/env.js";
import { applicationsRouter } from "./routes/applications.js";
import { eventsRouter } from "./routes/events.js";
import { infrastructureRouter } from "./routes/infrastructure.js";
import { jobsRouter } from "./routes/jobs.js";
import { logsRouter } from "./routes/logs.js";
import { systemRouter } from "./routes/system.js";
import { testingRouter } from "./routes/testing.js";
import { dnsServer } from "./services/dns-server.js";
import { recordEvent } from "./services/events.js";
import { syncInfrastructure } from "./services/infrastructure-sync.js";

const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors());

app.get("/health", (c) => {
  return c.json({ ok: true, timestamp: nowIso() });
});

app.route("/api/system", systemRouter);
app.route("/api/applications", applicationsRouter);
app.route("/api/jobs", jobsRouter);
app.route("/api/events", eventsRouter);
app.route("/api/infrastructure", infrastructureRouter);
app.route("/api/logs", logsRouter);
app.route("/api/testing", testingRouter);

app.get("/api", (c) => {
  return c.json({
    service: "lab-core-backend",
    version: "0.1.0",
    timestamp: nowIso()
  });
});

const currentEventCount = Number(
  (db.prepare("SELECT COUNT(*) as count FROM system_events").get() as { count: number } | undefined)?.count ?? 0
);
if (currentEventCount === 0) {
  recordEvent({
    scope: "system",
    level: "info",
    title: "Lab-Core v3 を初期化しました",
    message: "バックエンドが初回起動しました。"
  });
}

void dnsServer.start();

try {
  syncInfrastructure("backend-startup");
} catch (error) {
  const message = error instanceof Error ? error.message : "不明なエラー";
  recordEvent({
    scope: "infrastructure",
    level: "warning",
    title: "起動時の DNS/Proxy 同期に失敗しました",
    message
  });
}

serve(
  {
    fetch: app.fetch,
    port: env.port
  },
  () => {
    // eslint-disable-next-line no-console
    console.log(`[lab-core-backend] listening on :${env.port}`);
  }
);
