#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const proxyContainer = "labcore-dev-proxy-proxy-1";
const appNetworkPattern = /^labcore-[^/\s]+_default$/;

function runDocker(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function listNetworks() {
  const output = runDocker(["network", "ls", "--format", "{{.Name}}"]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && appNetworkPattern.test(line));
}

function ensureProxyContainerExists() {
  const output = runDocker(["ps", "--filter", `name=^/${proxyContainer}$`, "--format", "{{.Names}}"]);
  return output === proxyContainer;
}

function isConnected(networkName) {
  const output = runDocker(["network", "inspect", networkName, "--format", "{{json .Containers}}"]);
  return output.includes(proxyContainer);
}

function connect(networkName) {
  execFileSync("docker", ["network", "connect", networkName, proxyContainer], {
    stdio: ["ignore", "pipe", "pipe"]
  });
}

if (!ensureProxyContainerExists()) {
  console.log("proxy container is not running; skip network refresh");
  process.exit(0);
}

const networks = listNetworks();
const connected = [];

for (const networkName of networks) {
  if (isConnected(networkName)) {
    continue;
  }

  try {
    connect(networkName);
    connected.push(networkName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`failed to connect proxy to ${networkName}: ${message}`);
  }
}

console.log(
  connected.length > 0
    ? `proxy connected to: ${connected.join(", ")}`
    : networks.length > 0
      ? "proxy networks already up to date"
      : "no application networks found"
);
