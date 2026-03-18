import fs from "node:fs";
import path from "node:path";

function toAbsolutePath(baseDir: string, value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(baseDir, value);
}

function findProjectRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }

    current = parent;
  }
}

const baseDir = findProjectRoot(process.cwd());

function loadDotEnvIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();
    if (value.length >= 2) {
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvIfExists(path.resolve(baseDir, "core/backend/.env"));

function toExecutionMode(value: string | undefined): "dry-run" | "execute" {
  if (value === "execute") {
    return "execute";
  }
  return "dry-run";
}

function toBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function toPort(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  return defaultValue;
}

function toCsvList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export const env = {
  port: Number(process.env.LAB_CORE_PORT ?? 7300),
  dbPath: toAbsolutePath(baseDir, process.env.LAB_CORE_DB_PATH ?? "./core/backend/data/database.sqlite"),
  dockerSocket: process.env.LAB_CORE_DOCKER_SOCKET ?? "/var/run/docker.sock",
  appsRoot: toAbsolutePath(baseDir, process.env.LAB_CORE_APPS_ROOT ?? "./runtime/apps"),
  appDataRoot: toAbsolutePath(baseDir, process.env.LAB_CORE_APPDATA_ROOT ?? "./runtime/appdata"),
  executionMode: toExecutionMode(process.env.LAB_CORE_EXECUTION_MODE),
  mainServiceIp: process.env.LAB_CORE_MAIN_SERVICE_IP ?? "192.168.11.224",
  sshServiceIp: process.env.LAB_CORE_SSH_SERVICE_IP ?? "192.168.11.225",
  rootDomain: process.env.LAB_CORE_ROOT_DOMAIN ?? "fukaya-sus.lab",
  generatedProxyConfigPath: toAbsolutePath(
    baseDir,
    process.env.LAB_CORE_PROXY_CONFIG_PATH ?? "./core/backend/data/generated/Caddyfile"
  ),
  generatedDnsHostsPath: toAbsolutePath(
    baseDir,
    process.env.LAB_CORE_DNS_HOSTS_PATH ?? "./core/backend/data/generated/fukaya-sus.hosts"
  ),
  generatedSyncDir: toAbsolutePath(baseDir, process.env.LAB_CORE_SYNC_DIR ?? "./core/backend/data/generated"),
  dnsServerEnabled: toBoolean(process.env.LAB_CORE_DNS_SERVER_ENABLED, true),
  dnsBindHost: process.env.LAB_CORE_DNS_BIND_HOST ?? "127.0.0.1",
  dnsPort: toPort(process.env.LAB_CORE_DNS_PORT, 53),
  dnsUpstreams: toCsvList(process.env.LAB_CORE_DNS_UPSTREAMS)
};
