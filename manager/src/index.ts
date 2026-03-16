import Docker from "dockerode";
import { IncomingMessage } from "http";

const SOCKET_PATH = process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock";
const NETWORK_NAME = process.env.NETWORK_NAME ?? "lab-bridge";
const RECONNECT_DELAY_MS = Number(process.env.RECONNECT_DELAY_MS ?? "3000");

type DockerEvent = {
  id?: string;
  Action?: string;
  Type?: string;
};

const docker = new Docker({ socketPath: SOCKET_PATH });
let stopping = false;
let eventStream: IncomingMessage | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  console.log(`[lab-wire] ${message}`);
}

async function ensureNetworkExists(): Promise<void> {
  try {
    await docker.getNetwork(NETWORK_NAME).inspect();
    log(`network '${NETWORK_NAME}' is available.`);
  } catch {
    throw new Error(
      `network '${NETWORK_NAME}' が見つかりません。先に setup.sh でネットワークを作成してください。`
    );
  }
}

async function connectContainerToBridge(containerId: string): Promise<void> {
  try {
    const container = docker.getContainer(containerId);
    const detail = await container.inspect();
    if (!detail.State?.Running) {
      return;
    }

    const attachedNetworks = Object.keys(detail.NetworkSettings?.Networks ?? {});
    if (attachedNetworks.includes(NETWORK_NAME)) {
      return;
    }

    await docker.getNetwork(NETWORK_NAME).connect({ Container: containerId });
    log(`container '${detail.Name.replace(/^\//, "")}' connected to '${NETWORK_NAME}'.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`failed to connect container '${containerId}': ${message}`);
  }
}

async function connectRunningContainers(): Promise<void> {
  const containers = await docker.listContainers({ all: false });
  for (const container of containers) {
    await connectContainerToBridge(container.Id);
  }
}

function parseAndHandleEvent(line: string): void {
  if (!line.trim()) {
    return;
  }

  let event: DockerEvent | null = null;
  try {
    event = JSON.parse(line) as DockerEvent;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`event parse error: ${message}`);
    return;
  }

  if (event?.Type !== "container" || event.Action !== "start" || !event.id) {
    return;
  }

  void connectContainerToBridge(event.id);
}

async function watchEvents(): Promise<void> {
  eventStream = (await docker.getEvents({
    filters: {
      type: ["container"],
      event: ["start"]
    }
  })) as IncomingMessage;

  log("watching docker start events...");

  await new Promise<void>((resolve, reject) => {
    if (!eventStream) {
      reject(new Error("docker event stream is not available"));
      return;
    }

    let buffer = "";

    eventStream.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        parseAndHandleEvent(line);
      }
    });

    eventStream.on("error", (error) => {
      reject(error);
    });

    eventStream.on("end", () => {
      resolve();
    });

    eventStream.on("close", () => {
      resolve();
    });
  });
}

async function run(): Promise<void> {
  while (!stopping) {
    try {
      await ensureNetworkExists();
      await connectRunningContainers();
      await watchEvents();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`watch loop error: ${message}`);
    } finally {
      if (eventStream) {
        eventStream.destroy();
        eventStream = null;
      }
    }

    if (!stopping) {
      log(`reconnecting in ${RECONNECT_DELAY_MS}ms...`);
      await sleep(RECONNECT_DELAY_MS);
    }
  }
}

function shutdown(signal: string): void {
  log(`received ${signal}, shutting down...`);
  stopping = true;
  if (eventStream) {
    eventStream.destroy();
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void run();
