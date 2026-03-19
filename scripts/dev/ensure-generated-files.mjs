#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(thisFile), "..", "..");
const generatedDir = path.join(projectRoot, "core", "backend", "data", "generated");
const caddyfilePath = path.join(generatedDir, "Caddyfile.dev");
const hostsPath = path.join(generatedDir, "fukaya-sus.hosts");

const defaultCaddyfile = `http:// {
  respond "Lab-Core bootstrap: generated config not ready yet" 503
}
`;

const defaultHostsFile = `# generated bootstrap placeholder
`;

function repairManagedPermissions() {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const gid = typeof process.getgid === "function" ? process.getgid() : 1000;

  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${projectRoot}:/workspace`,
      "alpine:3.20",
      "sh",
      "-lc",
      [
        "mkdir -p /workspace/core/backend/data/generated",
        "mkdir -p /workspace/runtime/apps",
        "mkdir -p /workspace/runtime/appdata",
        `chown -R ${uid}:${gid} /workspace/core/backend/data /workspace/runtime`
      ].join(" && ")
    ],
    {
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
}

function ensureFile(filePath, content) {
  if (fs.existsSync(filePath)) {
    return;
  }

  fs.writeFileSync(filePath, content, "utf8");
}

function runEnsure() {
  fs.mkdirSync(generatedDir, { recursive: true });
  ensureFile(caddyfilePath, defaultCaddyfile);
  ensureFile(hostsPath, defaultHostsFile);
}

try {
  runEnsure();
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "";

  if (code !== "EACCES") {
    throw error;
  }

  console.warn("managed runtime files are not writable; repairing ownership via Docker");
  try {
    repairManagedPermissions();
    runEnsure();
  } catch (repairError) {
    const message = repairError instanceof Error ? repairError.message : String(repairError);
    console.error("failed to repair managed file permissions automatically");
    console.error("run `yarn permissions:repair` once, then retry `yarn lab:up`");
    throw new Error(message);
  }
}

console.log(`ensured generated files in ${generatedDir}`);
