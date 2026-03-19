#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(thisFile), "..", "..");

const processes = [
  {
    label: "core",
    args: ["compose", "-f", "infra/compose/docker-compose.dev.yml", "logs", "-f", "--tail", "150", "backend", "dashboard"]
  },
  {
    label: "proxy",
    args: ["compose", "-f", "infra/compose/docker-compose.proxy.yml", "logs", "-f", "--tail", "150", "proxy"]
  },
  {
    label: "dns",
    args: ["compose", "-f", "infra/compose/docker-compose.dns.yml", "logs", "-f", "--tail", "150", "dns"]
  }
];

const children = processes.map((proc) => {
  const child = spawn("docker", proc.args, {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      return;
    }

    if (code && code !== 0) {
      process.stderr.write(`[lab:logs:${proc.label}] exited with code ${code}\n`);
    }
  });

  return child;
});

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(130);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(143);
});
