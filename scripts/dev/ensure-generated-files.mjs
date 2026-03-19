#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
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

fs.mkdirSync(generatedDir, { recursive: true });

if (!fs.existsSync(caddyfilePath)) {
  fs.writeFileSync(caddyfilePath, defaultCaddyfile, "utf8");
}

if (!fs.existsSync(hostsPath)) {
  fs.writeFileSync(hostsPath, defaultHostsFile, "utf8");
}

console.log(`ensured generated files in ${generatedDir}`);
