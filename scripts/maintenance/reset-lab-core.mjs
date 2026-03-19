#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = new Set(process.argv.slice(2));
const executeReset = argv.has("--yes");
const force = argv.has("--force");
const thisFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(thisFile), "..", "..");
const envPath = path.join(rootDir, "core", "backend", ".env");
const currentUid = typeof process.getuid === "function" ? process.getuid() : 1000;
const currentGid = typeof process.getgid === "function" ? process.getgid() : 1000;

function loadDotEnv(filePath) {
  const result = {};

  return fs
    .readFile(filePath, "utf8")
    .then((content) => {
      for (const rawLine of content.split(/\r?\n/)) {
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
        result[key] = value;
      }

      return result;
    })
    .catch(() => result);
}

function toAbsolutePath(value, fallback) {
  const target = value ?? fallback;
  return path.isAbsolute(target) ? target : path.resolve(rootDir, target);
}

function dockerOutput(args) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return "";
  }
}

function dockerSuccess(args) {
  try {
    execFileSync("docker", args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}

function dockerComposeSuccess(args) {
  try {
    execFileSync("docker", ["compose", ...args], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}

function listUnique(values) {
  return [...new Set(values.filter((value) => value.length > 0))].sort((a, b) => a.localeCompare(b));
}

function listLabCoreProjects() {
  const projectLines = dockerOutput([
    "ps",
    "-a",
    "--filter",
    "label=com.docker.compose.project",
    "--format",
    "{{.Label \"com.docker.compose.project\"}}"
  ]);

  return listUnique(
    projectLines
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("labcore-"))
  );
}

function listProjectContainers(projectName) {
  return listUnique(
    dockerOutput([
      "ps",
      "-a",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
      "--format",
      "{{.ID}}"
    ]).split(/\r?\n/).map((line) => line.trim())
  );
}

function listProjectNetworks(projectName) {
  return listUnique(
    dockerOutput([
      "network",
      "ls",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
      "--format",
      "{{.ID}}"
    ]).split(/\r?\n/).map((line) => line.trim())
  );
}

function listProjectVolumes(projectName) {
  return listUnique(
    dockerOutput([
      "volume",
      "ls",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
      "--format",
      "{{.Name}}"
    ]).split(/\r?\n/).map((line) => line.trim())
  );
}

function isSafeTarget(targetPath) {
  const normalized = path.resolve(targetPath);
  const blocked = new Set([path.resolve("/"), path.resolve(os.homedir()), rootDir]);
  return !blocked.has(normalized);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function clearDirectoryContents(directoryPath) {
  try {
    await fs.mkdir(directoryPath, { recursive: true });
    const entries = await fs.readdir(directoryPath);
    for (const entry of entries) {
      await fs.rm(path.join(directoryPath, entry), { recursive: true, force: true });
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code !== "EACCES" && code !== "EPERM") {
      throw error;
    }

    repairPathOwnership(directoryPath);
    await fs.mkdir(directoryPath, { recursive: true });
    const entries = await fs.readdir(directoryPath);
    for (const entry of entries) {
      await fs.rm(path.join(directoryPath, entry), { recursive: true, force: true });
    }
  }
}

async function removeFileIfExists(filePath) {
  try {
    await fs.rm(filePath, { force: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code !== "EACCES" && code !== "EPERM") {
      throw error;
    }

    repairPathOwnership(filePath);
    await fs.rm(filePath, { force: true });
  }
}

function repairPathOwnership(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  const parentDir = path.dirname(resolvedPath);
  const baseName = path.basename(resolvedPath);

  dockerSuccess([
    "run",
    "--rm",
    "-v",
    `${parentDir}:/target-parent`,
    "alpine:3.20",
    "sh",
    "-lc",
    `if [ -e ${shellQuote(`/target-parent/${baseName}`)} ]; then chown -R ${currentUid}:${currentGid} ${shellQuote(`/target-parent/${baseName}`)}; fi`
  ]);
}

function checkPortOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

const envValues = await loadDotEnv(envPath);
const config = {
  apiPort: Number(envValues.LAB_CORE_PORT ?? 7300),
  dbPath: toAbsolutePath(envValues.LAB_CORE_DB_PATH, "./core/backend/data/database.sqlite"),
  generatedSyncDir: toAbsolutePath(envValues.LAB_CORE_SYNC_DIR, "./core/backend/data/generated"),
  appsRoot: toAbsolutePath(envValues.LAB_CORE_APPS_ROOT, "./runtime/apps"),
  appDataRoot: toAbsolutePath(envValues.LAB_CORE_APPDATA_ROOT, "./runtime/appdata")
};

const dbArtifacts = [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`];
const composeStacks = [
  ["-f", "infra/compose/docker-compose.proxy.yml", "down", "--remove-orphans"],
  ["-f", "infra/compose/docker-compose.dns.yml", "down", "--remove-orphans"],
  ["-f", "infra/compose/docker-compose.dev.yml", "down", "--remove-orphans"]
];
const runningPorts = [];

if (await checkPortOpen(config.apiPort)) {
  runningPorts.push(`backend port ${config.apiPort}`);
}
if (await checkPortOpen(5173)) {
  runningPorts.push("dashboard port 5173");
}

const projects = listLabCoreProjects();
const containerIds = listUnique(projects.flatMap((projectName) => listProjectContainers(projectName)));
const networkIds = listUnique(projects.flatMap((projectName) => listProjectNetworks(projectName)));
const volumeNames = listUnique(projects.flatMap((projectName) => listProjectVolumes(projectName)));

const previewLines = [
  "Lab-Core reset preview",
  `- DB artifacts: ${dbArtifacts.join(", ")}`,
  `- Generated dir: ${config.generatedSyncDir}`,
  `- Runtime apps dir: ${config.appsRoot}`,
  `- Runtime data dir: ${config.appDataRoot}`,
  `- Docker compose helper stacks: ${composeStacks.length}`,
  `- Docker compose projects: ${projects.length > 0 ? projects.join(", ") : "(none)"}`,
  `- Docker containers to remove: ${containerIds.length}`,
  `- Docker networks to remove: ${networkIds.length}`,
  `- Docker volumes to remove: ${volumeNames.length}`,
  "- Preserved: core/backend/.env, node_modules, git worktree"
];

if (runningPorts.length > 0) {
  previewLines.push(`- Warning: stop these listeners first if possible: ${runningPorts.join(", ")}`);
}

if (!isSafeTarget(config.generatedSyncDir) || !isSafeTarget(config.appsRoot) || !isSafeTarget(config.appDataRoot)) {
  console.error("reset refused: one or more configured paths are unsafe");
  process.exit(1);
}

if (!executeReset) {
  console.log(previewLines.join("\n"));
  console.log("");
  console.log("Run with --yes to execute the reset.");
  process.exit(0);
}

if (runningPorts.length > 0 && !force) {
  console.error(previewLines.join("\n"));
  console.error("");
  console.error("reset aborted: stop the running dev servers first, or re-run with --force");
  process.exit(1);
}

for (const args of composeStacks) {
  dockerComposeSuccess(args);
}

if (containerIds.length > 0) {
  dockerSuccess(["rm", "-f", ...containerIds]);
}

for (const networkId of networkIds) {
  dockerSuccess(["network", "rm", networkId]);
}

for (const volumeName of volumeNames) {
  dockerSuccess(["volume", "rm", "-f", volumeName]);
}

for (const dbArtifact of dbArtifacts) {
  await removeFileIfExists(dbArtifact);
}

await clearDirectoryContents(config.generatedSyncDir);
await clearDirectoryContents(config.appsRoot);
await clearDirectoryContents(config.appDataRoot);

const summaryLines = [
  "Lab-Core reset completed",
  `- Removed DB artifacts: ${dbArtifacts.length}`,
  `- Cleared generated dir: ${config.generatedSyncDir}`,
  `- Cleared runtime apps dir: ${config.appsRoot}`,
  `- Cleared runtime data dir: ${config.appDataRoot}`,
  `- Removed Docker containers: ${containerIds.length}`,
  `- Removed Docker networks: ${networkIds.length}`,
  `- Removed Docker volumes: ${volumeNames.length}`,
  "- Preserved: core/backend/.env"
];

console.log(summaryLines.join("\n"));
