import dgram from "node:dgram";
import { Hono } from "hono";
import net from "node:net";
import { db, nowIso } from "../lib/db.js";
import { env } from "../lib/env.js";
import { dnsServer } from "../services/dns-server.js";

export const systemRouter = new Hono();

const DNS_PROBE_QUERY = Buffer.from([
  0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x08, 0x6c, 0x61, 0x62, 0x63, 0x6f, 0x72, 0x65,
  0x0a, 0x66, 0x75, 0x6b, 0x61, 0x79, 0x61, 0x2d, 0x73, 0x75, 0x73,
  0x03, 0x6c, 0x61, 0x62, 0x00,
  0x00, 0x01, 0x00, 0x01
]);

async function probeUdp(host: string, port: number): Promise<{ reachable: boolean; error: string | null }> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      resolve({ reachable: false, error: "timeout" });
    }, 500);

    socket.once("message", () => {
      clearTimeout(timer);
      socket.close();
      resolve({ reachable: true, error: null });
    });

    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.close();
      resolve({ reachable: false, error: error.message });
    });

    socket.send(DNS_PROBE_QUERY, port, host, (error) => {
      if (!error) {
        return;
      }
      clearTimeout(timer);
      socket.close();
      resolve({ reachable: false, error: error.message });
    });
  });
}

async function probeTcp(host: string, port: number): Promise<{ reachable: boolean; error: string | null }> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ reachable: false, error: "timeout" });
    }, 500);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve({ reachable: true, error: null });
    });

    socket.once("error", (error) => {
      clearTimeout(timer);
      resolve({ reachable: false, error: error.message });
    });
  });
}

systemRouter.get("/status", async (c) => {
  const totalApps = Number(
    (db.prepare("SELECT COUNT(*) as count FROM applications").get() as { count: number } | undefined)?.count ?? 0
  );
  const runningApps = Number(
    (
      db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Running'").get() as
        | { count: number }
        | undefined
    )?.count ?? 0
  );
  const degradedApps = Number(
    (
      db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Degraded'").get() as
        | { count: number }
        | undefined
    )?.count ?? 0
  );
  const failedApps = Number(
    (
      db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Failed'").get() as
        | { count: number }
        | undefined
    )?.count ?? 0
  );

  const queuedJobs = Number(
    (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'queued'").get() as { count: number } | undefined)
      ?.count ?? 0
  );
  const runningJobs = Number(
    (
      db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").get() as
        | { count: number }
        | undefined
    )?.count ?? 0
  );

  const relayRequired = env.dnsServerEnabled && env.dnsBindHost === "127.0.0.1" && env.dnsPort !== 53;
  const relayTargetHost = env.dnsBindHost;
  const relayTargetPort = 53;
  const udpRelay = relayRequired ? await probeUdp(relayTargetHost, relayTargetPort) : { reachable: true, error: null };
  const tcpRelay = relayRequired ? await probeTcp(relayTargetHost, relayTargetPort) : { reachable: true, error: null };
  const relayLastError = udpRelay.error ?? tcpRelay.error ?? null;

  const dnsStatus = dnsServer.getStatus();

  return c.json({
    generatedAt: nowIso(),
    applicationSummary: {
      total: totalApps,
      running: runningApps,
      degraded: degradedApps,
      failed: failedApps
    },
    jobSummary: {
      queued: queuedJobs,
      running: runningJobs
    },
    paths: {
      dbPath: env.dbPath,
      appsRoot: env.appsRoot,
      appDataRoot: env.appDataRoot,
      generatedProxyConfigPath: env.generatedProxyConfigPath,
      generatedDnsHostsPath: env.generatedDnsHostsPath
    },
    execution: {
      mode: env.executionMode,
      mainServiceIp: env.mainServiceIp,
      sshServiceIp: env.sshServiceIp,
      rootDomain: env.rootDomain
    },
    dnsServer: {
      ...dnsStatus,
      relay: {
        required: relayRequired,
        targetHost: relayTargetHost,
        targetPort: relayTargetPort,
        udpReachable: udpRelay.reachable,
        tcpReachable: tcpRelay.reachable,
        lastError: relayLastError
      }
    }
  });
});
