#!/usr/bin/env node

import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:7300";
const thisFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(thisFile), "..", "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function withHostnameSuffix(hostname, suffix) {
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 2) {
    return `${hostname}-${suffix}`;
  }
  const [head, ...rest] = labels;
  return [`${head}-${suffix}`, ...rest].join(".");
}

async function requestJson(method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let json;
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`[${method} ${endpoint}] HTTP ${response.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

async function requestExpectStatus(method, endpoint, expectedStatus, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let json;
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (response.status !== expectedStatus) {
    throw new Error(`[${method} ${endpoint}] expected ${expectedStatus} but got ${response.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

async function waitForJob(jobId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const jobsResponse = await requestJson("GET", "/api/jobs?limit=200");
    const found = (jobsResponse.jobs ?? []).find((job) => job.job_id === jobId);
    if (found) {
      if (found.status === "succeeded") {
        return found;
      }
      if (found.status === "failed") {
        throw new Error(`job failed: ${jobId} (${found.message ?? "no-message"})`);
      }
    }
    await sleep(300);
  }
  throw new Error(`job timeout: ${jobId}`);
}

function fixturePayload(fixtures, fixtureId, suffix) {
  const fixture = fixtures.find((item) => item.id === fixtureId);
  assert(fixture, `fixture not found: ${fixtureId}`);

  const payload = fixture.payload;
  return {
    ...payload,
    name: `${payload.name}-${suffix}`.slice(0, 80),
    hostname: withHostnameSuffix(payload.hostname, suffix)
  };
}

async function main() {
  const summary = {
    appIds: [],
    checked: []
  };

  const health = await requestJson("GET", "/health");
  assert(health.ok === true, "health check failed");
  summary.checked.push("health");

  const system = await requestJson("GET", "/api/system/status");
  assert(system.execution?.mode === "dry-run" || system.execution?.mode === "execute", "execution mode not found");
  summary.checked.push("system-status");

  const fixtureResponse = await requestJson("GET", "/api/testing/registration-fixtures");
  const fixtures = fixtureResponse.fixtures ?? [];
  assert(fixtures.length >= 3, "registration fixtures are missing");
  summary.checked.push("fixture-api");

  const suffixA = uniqueSuffix();
  const appA = fixturePayload(fixtures, "oruca_standard", suffixA);
  const createdA = await requestJson("POST", "/api/applications", appA);
  assert(createdA.jobId, "deploy job id missing for appA");
  summary.appIds.push(createdA.applicationId);
  await waitForJob(createdA.jobId);
  summary.checked.push("create-appA");

  await waitForJob((await requestJson("POST", `/api/applications/${createdA.applicationId}/restart`)).jobId);
  summary.checked.push("restart-appA");

  await waitForJob(
    (await requestJson("POST", `/api/applications/${createdA.applicationId}/rebuild`, { keepData: true })).jobId
  );
  await waitForJob(
    (await requestJson("POST", `/api/applications/${createdA.applicationId}/rebuild`, { keepData: false })).jobId
  );
  summary.checked.push("rebuild-appA");

  const updateCheck = await requestJson("POST", `/api/applications/${createdA.applicationId}/update-check`);
  assert(typeof updateCheck.hasUpdate === "boolean", "update-check hasUpdate missing");
  summary.checked.push("update-check-appA");

  const updateJob = await requestJson("POST", `/api/applications/${createdA.applicationId}/update`);
  await waitForJob(updateJob.jobId);
  summary.checked.push("update-appA");

  let appADetail = await requestJson("GET", `/api/applications/${createdA.applicationId}`);
  assert(appADetail.application.previous_commit, "previous_commit should exist after update");

  const rollbackJob = await requestJson("POST", `/api/applications/${createdA.applicationId}/rollback`);
  await waitForJob(rollbackJob.jobId);
  summary.checked.push("rollback-appA");

  appADetail = await requestJson("GET", `/api/applications/${createdA.applicationId}`);
  assert(appADetail.application.current_commit, "current_commit missing after rollback");

  const logServices = await requestJson("GET", `/api/logs/${createdA.applicationId}/services`);
  assert(Array.isArray(logServices.services), "log services response invalid");
  assert(logServices.services.length > 0, "log services is empty");

  const logs = await requestJson(
    "GET",
    `/api/logs/${createdA.applicationId}?service=${encodeURIComponent(logServices.services[0])}&tail=100`
  );
  assert(Array.isArray(logs.lines), "logs.lines is not array");
  summary.checked.push("logs-appA");

  await requestJson("POST", "/api/infrastructure/sync?reason=full-smoke-test");
  const caddyPath = path.join(projectRoot, "core/backend/data/generated/Caddyfile");
  const dnsPath = path.join(projectRoot, "core/backend/data/generated/fukaya-sus.hosts");
  const caddyFile = await fs.readFile(caddyPath, "utf8");
  const dnsFile = await fs.readFile(dnsPath, "utf8");
  assert(caddyFile.includes(appA.hostname), "Caddyfile does not include appA hostname");
  assert(dnsFile.includes("fukaya-sus.lab"), "dns hosts file is not generated");
  summary.checked.push("infra-sync");

  const suffixB = uniqueSuffix();
  const appB = fixturePayload(fixtures, "simple_web", suffixB);
  const createdB = await requestJson("POST", "/api/applications", appB);
  summary.appIds.push(createdB.applicationId);
  await waitForJob(createdB.jobId);
  summary.checked.push("create-appB");

  const deleteJob = await requestJson("DELETE", `/api/applications/${createdB.applicationId}`, { mode: "full" });
  await waitForJob(deleteJob.jobId);
  summary.checked.push("delete-appB");

  const suffixC = uniqueSuffix();
  const appC = fixturePayload(fixtures, "headless_api", suffixC);
  const createdC = await requestJson("POST", "/api/applications", appC);
  summary.appIds.push(createdC.applicationId);
  await waitForJob(createdC.jobId);
  summary.checked.push("create-appC");

  const rollbackRejected = await requestExpectStatus("POST", `/api/applications/${createdC.applicationId}/rollback`, 400);
  assert(
    typeof rollbackRejected.message === "string" && rollbackRejected.message.includes("ロールバック可能"),
    "rollback rejection message unexpected"
  );
  summary.checked.push("rollback-reject-appC");

  const apps = await requestJson("GET", "/api/applications");
  const appIds = new Set((apps.applications ?? []).map((item) => item.application_id));
  assert(!appIds.has(createdB.applicationId), "deleted appB still exists");
  assert(appIds.has(createdA.applicationId), "appA missing after workflow");
  assert(appIds.has(createdC.applicationId), "appC missing after workflow");
  summary.checked.push("final-list");

  const events = await requestJson("GET", "/api/events?limit=200");
  assert((events.events ?? []).length > 0, "events should not be empty");
  summary.checked.push("events");

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        checkedCount: summary.checked.length,
        checked: summary.checked,
        appIds: summary.appIds
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`[smoke-test] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
