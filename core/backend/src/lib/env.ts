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

function toExecutionMode(value: string | undefined): "dry-run" | "execute" {
  if (value === "execute") {
    return "execute";
  }
  return "dry-run";
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
  generatedSyncDir: toAbsolutePath(baseDir, process.env.LAB_CORE_SYNC_DIR ?? "./core/backend/data/generated")
};
