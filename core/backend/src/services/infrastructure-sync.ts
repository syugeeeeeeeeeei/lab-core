import fs from "node:fs";
import path from "node:path";
import { db, nowIso } from "../lib/db.js";
import { env } from "../lib/env.js";
import { recordEvent } from "./events.js";

type RouteRow = {
  hostname: string;
  upstream_container: string | null;
  upstream_port: number;
  public_service_name: string;
  application_name: string;
};

const routeQuery = db.prepare(`
  SELECT
    r.hostname,
    r.upstream_container,
    r.upstream_port,
    d.public_service_name,
    a.name as application_name
  FROM routes r
  INNER JOIN deployments d ON d.application_id = r.application_id
  INNER JOIN applications a ON a.application_id = r.application_id
  WHERE r.enabled = 1 AND d.enabled = 1
  ORDER BY r.hostname ASC
`);

function ensureSyncDir(): void {
  fs.mkdirSync(env.generatedSyncDir, { recursive: true });
}

function buildCaddyfile(routes: RouteRow[]): string {
  const lines: string[] = [];
  lines.push(`# generated_at: ${nowIso()}`);
  lines.push(`# mode: ${env.executionMode}`);
  lines.push("");

  for (const route of routes) {
    const upstream = route.upstream_container ?? route.public_service_name;
    lines.push(`${route.hostname} {`);
    lines.push(`  reverse_proxy ${upstream}:${route.upstream_port}`);
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

function buildDnsHosts(routes: RouteRow[]): string {
  const lines: string[] = [];
  lines.push(`# generated_at: ${nowIso()}`);
  lines.push(`${env.sshServiceIp} ssh.${env.rootDomain}`);

  for (const route of routes) {
    lines.push(`${env.mainServiceIp} ${route.hostname}`);
  }

  return lines.join("\n") + "\n";
}

export function syncInfrastructure(reason: string): { routeCount: number } {
  const routes = routeQuery.all() as RouteRow[];
  ensureSyncDir();

  const caddyfile = buildCaddyfile(routes);
  const dnsHosts = buildDnsHosts(routes);

  fs.writeFileSync(env.generatedProxyConfigPath, caddyfile, "utf-8");
  fs.writeFileSync(env.generatedDnsHostsPath, dnsHosts, "utf-8");

  recordEvent({
    scope: "infrastructure",
    level: "info",
    title: "DNS/Proxy 設定を同期しました",
    message: `reason=${reason}, routes=${routes.length}, proxy=${path.basename(env.generatedProxyConfigPath)}, dns=${path.basename(env.generatedDnsHostsPath)}`
  });

  return { routeCount: routes.length };
}
