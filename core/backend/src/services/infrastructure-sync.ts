import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db, nowIso } from "../lib/db.js";
import { env } from "../lib/env.js";
import { recordEvent } from "./events.js";

type RouteRow = {
  application_id: string;
  hostname: string;
  upstream_container: string | null;
  upstream_port: number;
  public_service_name: string;
  application_name: string;
};

type RuntimeContainerInfo = {
  runtimeName: string;
  serviceName: string;
  workingDir: string;
  networks: string[];
  healthState: string;
};

const routeQuery = db.prepare(`
  SELECT
    r.application_id,
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
const deleteContainerInstancesStatement = db.prepare(`
  DELETE FROM container_instances
  WHERE application_id = ?
`);
const insertContainerInstanceStatement = db.prepare(`
  INSERT INTO container_instances (
    container_id,
    application_id,
    service_name,
    runtime_name,
    health_state,
    restart_count,
    last_seen_at
  ) VALUES (?, ?, ?, ?, ?, 0, ?)
`);

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

  if (mode === "http-only") {
    const dashboardHost = `dashboard.${env.rootDomain}`;
    const apiHost = `api.${env.rootDomain}`;
    lines.push(`http://${dashboardHost} {`);
    lines.push("  handle /api* {");
    lines.push(`    reverse_proxy host.docker.internal:${env.port}`);
    lines.push("  }");
    lines.push("  handle {");
    lines.push("    reverse_proxy host.docker.internal:5173");
    lines.push("  }");
    lines.push("}");
    lines.push("");
    lines.push(`http://${apiHost} {`);
    lines.push(`  reverse_proxy host.docker.internal:${env.port}`);
    lines.push("}");
    lines.push("");
  }

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
  lines.push(`${env.mainServiceIp} dashboard.${env.rootDomain}`);
  lines.push(`${env.mainServiceIp} api.${env.rootDomain}`);

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

function inspectDockerContainers(containerIds: string[]): Array<Record<string, unknown>> {
  if (containerIds.length === 0) {
    return [];
  }

  const raw = runDockerCli(["inspect", ...containerIds]);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function listManagedComposeContainers(): RuntimeContainerInfo[] {
  const containerIds = runDockerCli([
    "ps",
    "-a",
    "--filter",
    "label=com.docker.compose.project.working_dir",
    "--format",
    "{{.ID}}"
  ]);
  if (!containerIds) {
    return [];
  }

  const inspected = inspectDockerContainers(
    containerIds
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );

  return inspected
    .map((container) => {
      const config = (container.Config as Record<string, unknown> | undefined) ?? {};
      const labels = (config.Labels as Record<string, string> | undefined) ?? {};
      const workingDir = labels["com.docker.compose.project.working_dir"] ?? "";
      const runtimeName = typeof container.Name === "string" ? String(container.Name).replace(/^\//, "") : "";
      const networks = Object.keys(((container.NetworkSettings as Record<string, unknown> | undefined)?.Networks as Record<string, unknown>) ?? {});
      const healthState =
        ((container.State as Record<string, unknown> | undefined)?.Health as Record<string, unknown> | undefined)?.Status;

      return {
        runtimeName,
        serviceName: labels["com.docker.compose.service"] ?? "",
        workingDir,
        networks,
        healthState:
          typeof healthState === "string"
            ? healthState
            : String(((container.State as Record<string, unknown> | undefined)?.Status as string | undefined) ?? "unknown")
      };
    })
    .filter((container) => container.runtimeName.length > 0)
    .filter((container) => container.workingDir.startsWith(env.appsRoot))
    .map(({ runtimeName, serviceName, workingDir, networks, healthState }) => ({
      runtimeName,
      serviceName,
      workingDir,
      networks,
      healthState
    }));
}

function discoverRuntimeContainersForApp(applicationName: string): RuntimeContainerInfo[] {
  const workingDir = path.join(env.appsRoot, applicationName);
  return listManagedComposeContainers().filter((container) => container.workingDir === workingDir);
}

function syncContainerInstances(applicationId: string, containers: RuntimeContainerInfo[]): void {
  db.transaction(() => {
    deleteContainerInstancesStatement.run(applicationId);

    for (const container of containers) {
      insertContainerInstanceStatement.run(
        container.runtimeName,
        applicationId,
        container.serviceName || container.runtimeName,
        container.runtimeName,
        container.healthState,
        nowIso()
      );
    }
  })();
}

function resolveRuntimeRoutes(routes: RouteRow[]): RouteRow[] {
  const containerMap = new Map<string, RuntimeContainerInfo[]>();

  return routes.map((route) => {
    if (!containerMap.has(route.application_id)) {
      const containers = discoverRuntimeContainersForApp(route.application_name);
      containerMap.set(route.application_id, containers);
      syncContainerInstances(route.application_id, containers);
    }

    const containers = containerMap.get(route.application_id) ?? [];
    const runtimeContainer =
      containers.find((container) => container.serviceName === route.public_service_name)
      ?? containers.find((container) => container.serviceName === route.upstream_container)
      ?? containers.find((container) => container.runtimeName === route.upstream_container);

    return {
      ...route,
      upstream_container: runtimeContainer?.runtimeName ?? route.upstream_container
    };
  });
}

function refreshLocalDevProxy(): void {
  const runningProxy = runDockerCli(["ps", "--filter", `name=^/${DEV_PROXY_CONTAINER}$`, "--format", "{{.Names}}"]);
  if (runningProxy !== DEV_PROXY_CONTAINER) {
    return;
  }

  const networks = [...new Set(listManagedComposeContainers().flatMap((container) => container.networks))].sort((a, b) =>
    a.localeCompare(b)
  );

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
  const routes = resolveRuntimeRoutes(routeQuery.all() as RouteRow[]);
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
