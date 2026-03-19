#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(thisFile), "..", "..");
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
    stdio: "inherit"
  }
);
