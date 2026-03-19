import { execFileSync } from "node:child_process";
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
const DEV_PROXY_CONTAINER = "labcore-dev-proxy-proxy-1";
const DEV_PROXY_NETWORK_PATTERN = /^labcore-[^/\s]+_default$/;

function ensureSyncDir(): void {
  fs.mkdirSync(env.generatedSyncDir, { recursive: true });
}

function buildCaddyfile(routes: RouteRow[]): string {
  return buildCaddyfileVariant(routes, "default");
}

function buildLocalDevCaddyfile(routes: RouteRow[]): string {
  return buildCaddyfileVariant(routes, "http-only");
}

function buildCaddyfileVariant(routes: RouteRow[], mode: "default" | "http-only"): string {
  const lines: string[] = [];
  lines.push(`# generated_at: ${nowIso()}`);
  lines.push(`# mode: ${env.executionMode}`);
  lines.push(`# variant: ${mode}`);
  lines.push("");

  for (const route of routes) {
    const upstream = route.upstream_container ?? route.public_service_name;
    const siteLabel = mode === "http-only" ? `http://${route.hostname}` : route.hostname;
    lines.push(`${siteLabel} {`);
    lines.push(`  reverse_proxy ${upstream}:${route.upstream_port} {`);
    lines.push("    transport http {");
    lines.push("      dial_timeout 2s");
    lines.push("      response_header_timeout 4s");
    lines.push("    }");
    lines.push("  }");
    lines.push("  handle_errors {");
    lines.push("    @upstream expression `{http.error.status_code} == 502 || {http.error.status_code} == 503 || {http.error.status_code} == 504`");
    lines.push(
      `    respond @upstream "Lab-Core fallback: upstream unavailable | host={http.request.host} | upstream=${upstream}:${route.upstream_port} | status={http.error.status_code}" {http.error.status_code}`
    );
    lines.push(
      '    respond "Lab-Core fallback: request failed | host={http.request.host} | status={http.error.status_code}" {http.error.status_code}'
    );
    lines.push("  }");
    lines.push("}");
    lines.push("");
  }

  if (mode === "http-only") {
    lines.push("http:// {");
    lines.push(
      '  respond "Lab-Core fallback: route not configured | host={http.request.host} | reason=no matching route" 404'
    );
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

function runDockerCli(args: string[]): string | null {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return null;
  }
}

function refreshLocalDevProxy(): void {
  const runningProxy = runDockerCli(["ps", "--filter", `name=^/${DEV_PROXY_CONTAINER}$`, "--format", "{{.Names}}"]);
  if (runningProxy !== DEV_PROXY_CONTAINER) {
    return;
  }

  const networksOutput = runDockerCli(["network", "ls", "--format", "{{.Name}}"]);
  if (!networksOutput) {
    return;
  }

  const networks = networksOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && DEV_PROXY_NETWORK_PATTERN.test(line));

  for (const networkName of networks) {
    const containers = runDockerCli(["network", "inspect", networkName, "--format", "{{json .Containers}}"]) ?? "";
    if (containers.includes(DEV_PROXY_CONTAINER)) {
      continue;
    }
    runDockerCli(["network", "connect", networkName, DEV_PROXY_CONTAINER]);
  }

  runDockerCli(["restart", DEV_PROXY_CONTAINER]);
}

export function syncInfrastructure(reason: string): { routeCount: number } {
  const routes = routeQuery.all() as RouteRow[];
  ensureSyncDir();

  const caddyfile = buildCaddyfile(routes);
  const localDevCaddyfile = buildLocalDevCaddyfile(routes);
  const dnsHosts = buildDnsHosts(routes);
  const localDevCaddyfilePath = path.join(env.generatedSyncDir, "Caddyfile.dev");

  fs.writeFileSync(env.generatedProxyConfigPath, caddyfile, "utf-8");
  fs.writeFileSync(localDevCaddyfilePath, localDevCaddyfile, "utf-8");
  fs.writeFileSync(env.generatedDnsHostsPath, dnsHosts, "utf-8");
  refreshLocalDevProxy();

  recordEvent({
    scope: "infrastructure",
    level: "info",
    title: "DNS/Proxy 設定を同期しました",
    message: `reason=${reason}, routes=${routes.length}, proxy=${path.basename(env.generatedProxyConfigPath)}, dns=${path.basename(env.generatedDnsHostsPath)}`
  });

  return { routeCount: routes.length };
}
