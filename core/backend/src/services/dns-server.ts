import dgram from "node:dgram";
import fs from "node:fs";
import net from "node:net";
import { env } from "../lib/env.js";
import { recordEvent } from "./events.js";

const DNS_PORT = 53;
const DNS_TYPE_A = 1;
const DNS_TYPE_AAAA = 28;
const DNS_TYPE_ANY = 255;
const DNS_CLASS_IN = 1;
const FLAG_QR = 0x8000;
const FLAG_AA = 0x0400;
const FLAG_RD = 0x0100;
const FLAG_RA = 0x0080;
const RCODE_NO_ERROR = 0;
const RCODE_NAME_ERROR = 3;
const RCODE_SERVER_FAILURE = 2;
const DEFAULT_TTL_SECONDS = 30;
const DEFAULT_FORWARD_TIMEOUT_MS = 1500;

type DnsServerConfig = {
  enabled: boolean;
  bindHost: string;
  port: number;
  hostsFilePath: string;
  rootDomain: string;
  upstreams: string[];
};

type DnsRecord = {
  address: string;
  family: 4 | 6;
};

type DnsQuestion = {
  name: string;
  type: number;
  classCode: number;
  questionEndOffset: number;
};

type DnsServerStatus = {
  enabled: boolean;
  bindHost: string;
  port: number;
  hostsFilePath: string;
  upstreams: string[];
  udpListening: boolean;
  tcpListening: boolean;
  lastError: string | null;
};

type StatusReporter = (level: "info" | "warning" | "error", title: string, message: string) => void;

function parseConfiguredUpstreams(configured: string[], bindHost: string): string[] {
  const normalizedConfigured = configured.map((value) => value.trim()).filter((value) => value.length > 0);
  if (normalizedConfigured.length > 0) {
    return normalizedConfigured;
  }

  try {
    const resolvConf = fs.readFileSync("/etc/resolv.conf", "utf8");
    const discovered = resolvConf
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("nameserver "))
      .map((line) => line.replace(/^nameserver\s+/, "").trim())
      .filter((value) => value.length > 0)
      .filter((value) => value !== bindHost && value !== "127.0.0.1" && value !== "::1");

    if (discovered.length > 0) {
      return [...new Set(discovered)];
    }
  } catch {
    // ignore and use fallback below
  }

  return ["1.1.1.1", "8.8.8.8"];
}

function parseHostsFile(filePath: string): Map<string, DnsRecord[]> {
  const records = new Map<string, DnsRecord[]>();
  if (!fs.existsSync(filePath)) {
    return records;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (line.length === 0) {
      continue;
    }

    const parts = line.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length < 2) {
      continue;
    }

    const [address, ...hostnames] = parts;
    const family = net.isIP(address);
    if (family !== 4 && family !== 6) {
      continue;
    }

    for (const rawHostname of hostnames) {
      const hostname = rawHostname.toLowerCase();
      const current = records.get(hostname) ?? [];
      current.push({
        address,
        family
      });
      records.set(hostname, current);
    }
  }

  return records;
}

function decodeDnsName(buffer: Buffer, startOffset: number): { name: string; nextOffset: number } {
  const labels: string[] = [];
  let offset = startOffset;
  let nextOffset = startOffset;
  let jumped = false;
  let jumps = 0;

  while (offset < buffer.length) {
    if (jumps > 32) {
      throw new Error("DNS name pointer depth exceeded.");
    }

    const length = buffer[offset];
    if (length === undefined) {
      throw new Error("DNS name is truncated.");
    }

    if (length === 0) {
      if (!jumped) {
        nextOffset = offset + 1;
      }
      return {
        name: labels.join(".").toLowerCase(),
        nextOffset
      };
    }

    if ((length & 0xc0) === 0xc0) {
      const nextByte = buffer[offset + 1];
      if (nextByte === undefined) {
        throw new Error("DNS name pointer is truncated.");
      }

      const pointer = ((length & 0x3f) << 8) | nextByte;
      if (!jumped) {
        nextOffset = offset + 2;
      }
      offset = pointer;
      jumped = true;
      jumps += 1;
      continue;
    }

    const labelStart = offset + 1;
    const labelEnd = labelStart + length;
    const label = buffer.subarray(labelStart, labelEnd).toString("utf8");
    labels.push(label);
    offset = labelEnd;
    if (!jumped) {
      nextOffset = offset;
    }
  }

  throw new Error("DNS name is truncated.");
}

function parseQuestion(buffer: Buffer): DnsQuestion | null {
  if (buffer.length < 18) {
    return null;
  }

  const questionCount = buffer.readUInt16BE(4);
  if (questionCount !== 1) {
    return null;
  }

  const decoded = decodeDnsName(buffer, 12);
  const typeOffset = decoded.nextOffset;
  if (typeOffset + 4 > buffer.length) {
    return null;
  }

  return {
    name: decoded.name,
    type: buffer.readUInt16BE(typeOffset),
    classCode: buffer.readUInt16BE(typeOffset + 2),
    questionEndOffset: typeOffset + 4
  };
}

function encodeAddress(address: string, family: 4 | 6): Buffer {
  if (family === 4) {
    return Buffer.from(
      address.split(".").map((segment) => {
        const value = Number(segment);
        return Number.isInteger(value) && value >= 0 && value <= 255 ? value : 0;
      })
    );
  }

  const expanded = expandIpv6(address);
  return Buffer.from(expanded.flatMap((segment) => [segment >> 8, segment & 0xff]));
}

function expandIpv6(address: string): number[] {
  const [headRaw, tailRaw] = address.split("::", 2);
  const head = headRaw ? headRaw.split(":").filter((segment) => segment.length > 0) : [];
  const tail = tailRaw ? tailRaw.split(":").filter((segment) => segment.length > 0) : [];
  const missing = 8 - (head.length + tail.length);
  const segments = [...head, ...new Array(Math.max(missing, 0)).fill("0"), ...tail];

  return segments.map((segment) => Number.parseInt(segment || "0", 16) & 0xffff).slice(0, 8);
}

function buildFlags(requestFlags: number, options: { authoritative?: boolean; recursionAvailable?: boolean; rcode?: number } = {}): number {
  return (
    FLAG_QR |
    (options.authoritative ? FLAG_AA : 0) |
    (requestFlags & FLAG_RD) |
    (options.recursionAvailable ? FLAG_RA : 0) |
    (requestFlags & 0x7800) |
    (options.rcode ?? RCODE_NO_ERROR)
  );
}

function buildResponse(
  request: Buffer,
  question: DnsQuestion,
  answers: DnsRecord[],
  options: { authoritative?: boolean; recursionAvailable?: boolean; rcode?: number } = {}
): Buffer {
  const requestFlags = request.readUInt16BE(2);
  const questionBytes = request.subarray(12, question.questionEndOffset);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(request.readUInt16BE(0), 0);
  header.writeUInt16BE(buildFlags(requestFlags, options), 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answers.length, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);

  const answerBuffers = answers.map((record) => {
    const namePointer = Buffer.from([0xc0, 0x0c]);
    const answer = Buffer.alloc(10);
    answer.writeUInt16BE(record.family === 4 ? DNS_TYPE_A : DNS_TYPE_AAAA, 0);
    answer.writeUInt16BE(DNS_CLASS_IN, 2);
    answer.writeUInt32BE(DEFAULT_TTL_SECONDS, 4);
    const rdata = encodeAddress(record.address, record.family);
    answer.writeUInt16BE(rdata.length, 8);
    return Buffer.concat([namePointer, answer, rdata]);
  });

  return Buffer.concat([header, questionBytes, ...answerBuffers]);
}

function buildNoDataResponse(request: Buffer, question: DnsQuestion, recursionAvailable: boolean): Buffer {
  return buildResponse(request, question, [], {
    authoritative: true,
    recursionAvailable,
    rcode: RCODE_NO_ERROR
  });
}

function buildNameErrorResponse(request: Buffer, question: DnsQuestion, recursionAvailable: boolean): Buffer {
  return buildResponse(request, question, [], {
    authoritative: true,
    recursionAvailable,
    rcode: RCODE_NAME_ERROR
  });
}

function buildServerFailureResponse(request: Buffer, question: DnsQuestion | null, recursionAvailable: boolean): Buffer {
  const requestFlags = request.length >= 4 ? request.readUInt16BE(2) : 0;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(request.length >= 2 ? request.readUInt16BE(0) : 0, 0);
  header.writeUInt16BE(buildFlags(requestFlags, { recursionAvailable, rcode: RCODE_SERVER_FAILURE }), 2);
  header.writeUInt16BE(question ? 1 : 0, 4);
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);

  if (!question) {
    return header;
  }

  return Buffer.concat([header, request.subarray(12, question.questionEndOffset)]);
}

function questionMatchesLocalRecord(question: DnsQuestion): boolean {
  return question.classCode === DNS_CLASS_IN && [DNS_TYPE_A, DNS_TYPE_AAAA, DNS_TYPE_ANY].includes(question.type);
}

async function forwardUdpQuery(query: Buffer, upstreams: string[]): Promise<Buffer> {
  let lastError: Error | null = null;

  for (const upstream of upstreams) {
    const family = net.isIP(upstream) === 6 ? "udp6" : "udp4";
    try {
      const response = await new Promise<Buffer>((resolve, reject) => {
        const socket = dgram.createSocket(family);
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error(`DNS upstream timeout: ${upstream}`));
        }, DEFAULT_FORWARD_TIMEOUT_MS);

        socket.once("error", (error) => {
          clearTimeout(timer);
          socket.close();
          reject(error);
        });

        socket.once("message", (message) => {
          clearTimeout(timer);
          socket.close();
          resolve(message);
        });

        socket.send(query, DNS_PORT, upstream, (error) => {
          if (error) {
            clearTimeout(timer);
            socket.close();
            reject(error);
          }
        });
      });

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("No DNS upstream is available.");
}

async function forwardTcpQuery(query: Buffer, upstreams: string[]): Promise<Buffer> {
  let lastError: Error | null = null;

  for (const upstream of upstreams) {
    try {
      const response = await new Promise<Buffer>((resolve, reject) => {
        const socket = net.createConnection({ host: upstream, port: DNS_PORT });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error(`DNS upstream timeout: ${upstream}`));
        }, DEFAULT_FORWARD_TIMEOUT_MS);

        const chunks: Buffer[] = [];
        let expectedLength: number | null = null;

        socket.once("error", (error) => {
          clearTimeout(timer);
          socket.destroy();
          reject(error);
        });

        socket.on("data", (chunk) => {
          chunks.push(chunk);
          const buffer = Buffer.concat(chunks);

          if (expectedLength === null && buffer.length >= 2) {
            expectedLength = buffer.readUInt16BE(0);
          }

          if (expectedLength !== null && buffer.length >= expectedLength + 2) {
            clearTimeout(timer);
            socket.end();
            resolve(buffer.subarray(2, expectedLength + 2));
          }
        });

        socket.once("connect", () => {
          const lengthPrefix = Buffer.alloc(2);
          lengthPrefix.writeUInt16BE(query.length, 0);
          socket.write(Buffer.concat([lengthPrefix, query]));
        });
      });

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("No DNS upstream is available.");
}

export class LabCoreDnsServer {
  private readonly config: DnsServerConfig;
  private readonly reportStatus: StatusReporter | undefined;
  private readonly status: DnsServerStatus;
  private udpServer: dgram.Socket | null = null;
  private tcpServer: net.Server | null = null;

  constructor(config: DnsServerConfig, reportStatus?: StatusReporter) {
    this.config = {
      ...config,
      upstreams: parseConfiguredUpstreams(config.upstreams, config.bindHost)
    };
    this.reportStatus = reportStatus;
    this.status = {
      enabled: this.config.enabled,
      bindHost: this.config.bindHost,
      port: this.config.port,
      hostsFilePath: this.config.hostsFilePath,
      upstreams: [...this.config.upstreams],
      udpListening: false,
      tcpListening: false,
      lastError: null
    };
  }

  getStatus(): DnsServerStatus {
    return {
      ...this.status,
      upstreams: [...this.status.upstreams]
    };
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.reportStatus?.("info", "DNS サーバーは無効です", "LAB_CORE_DNS_SERVER_ENABLED=false のため DNS サーバーは起動しません。");
      return;
    }

    this.status.lastError = null;
    this.status.udpListening = false;
    this.status.tcpListening = false;

    await Promise.all([this.startUdpServer(), this.startTcpServer()]);

    if (this.status.udpListening || this.status.tcpListening) {
      const transports = [this.status.udpListening ? "udp" : null, this.status.tcpListening ? "tcp" : null]
        .filter((value): value is string => value !== null)
        .join(",");
      this.reportStatus?.(
        "info",
        "DNS サーバーを起動しました",
        `bind=${this.config.bindHost}:${this.config.port}, transports=${transports}, hosts=${this.config.hostsFilePath}`
      );
    } else if (this.status.lastError) {
      this.reportStatus?.("error", "DNS サーバーの起動に失敗しました", this.status.lastError);
    }
  }

  async stop(): Promise<void> {
    await Promise.all([
      this.udpServer
        ? new Promise<void>((resolve) => {
            this.udpServer?.close(() => resolve());
            this.udpServer = null;
            this.status.udpListening = false;
          })
        : Promise.resolve(),
      this.tcpServer
        ? new Promise<void>((resolve, reject) => {
            this.tcpServer?.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
            this.tcpServer = null;
            this.status.tcpListening = false;
          })
        : Promise.resolve()
    ]);
  }

  private async startUdpServer(): Promise<void> {
    await new Promise<void>((resolve) => {
      const socket = dgram.createSocket(net.isIP(this.config.bindHost) === 6 ? "udp6" : "udp4");

      socket.on("message", (message, remoteInfo) => {
        void this.handleUdpQuery(message, remoteInfo);
      });

      socket.once("error", (error) => {
        this.status.lastError = error.message;
        resolve();
      });

      socket.bind(this.config.port, this.config.bindHost, () => {
        this.udpServer = socket;
        this.status.udpListening = true;
        resolve();
      });
    });
  }

  private async startTcpServer(): Promise<void> {
    await new Promise<void>((resolve) => {
      const server = net.createServer((socket) => {
        let buffer = Buffer.alloc(0);

        socket.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);

          while (buffer.length >= 2) {
            const messageLength = buffer.readUInt16BE(0);
            if (buffer.length < messageLength + 2) {
              break;
            }

            const query = buffer.subarray(2, messageLength + 2);
            buffer = buffer.subarray(messageLength + 2);

            void this.processQuery(query, "tcp")
              .then((response) => {
                if (!response) {
                  socket.end();
                  return;
                }

                const lengthPrefix = Buffer.alloc(2);
                lengthPrefix.writeUInt16BE(response.length, 0);
                socket.write(Buffer.concat([lengthPrefix, response]), () => {
                  socket.end();
                });
              })
              .catch(() => {
                socket.destroy();
              });
          }
        });
      });

      server.once("error", (error) => {
        this.status.lastError = error.message;
        resolve();
      });

      server.listen(this.config.port, this.config.bindHost, () => {
        this.tcpServer = server;
        this.status.tcpListening = true;
        resolve();
      });
    });
  }

  private async handleUdpQuery(message: Buffer, remoteInfo: dgram.RemoteInfo): Promise<void> {
    try {
      const response = await this.processQuery(message, "udp");
      if (response && this.udpServer) {
        this.udpServer.send(response, remoteInfo.port, remoteInfo.address);
      }
    } catch {
      // ignore malformed UDP packets
    }
  }

  private async processQuery(message: Buffer, transport: "udp" | "tcp"): Promise<Buffer | null> {
    const question = parseQuestion(message);
    const recursionAvailable = this.config.upstreams.length > 0;

    if (!question) {
      return buildServerFailureResponse(message, null, recursionAvailable);
    }

    const localRecords = parseHostsFile(this.config.hostsFilePath).get(question.name) ?? [];
    if (localRecords.length > 0) {
      if (!questionMatchesLocalRecord(question)) {
        return buildNoDataResponse(message, question, recursionAvailable);
      }

      const matchingAnswers =
        question.type === DNS_TYPE_ANY
          ? localRecords
          : localRecords.filter((record) => {
              if (question.type === DNS_TYPE_A) {
                return record.family === 4;
              }
              if (question.type === DNS_TYPE_AAAA) {
                return record.family === 6;
              }
              return false;
            });

      if (matchingAnswers.length > 0) {
        return buildResponse(message, question, matchingAnswers, {
          authoritative: true,
          recursionAvailable
        });
      }

      return buildNoDataResponse(message, question, recursionAvailable);
    }

    if (question.name === this.config.rootDomain || question.name.endsWith(`.${this.config.rootDomain}`)) {
      return buildNameErrorResponse(message, question, recursionAvailable);
    }

    try {
      return transport === "udp"
        ? await forwardUdpQuery(message, this.config.upstreams)
        : await forwardTcpQuery(message, this.config.upstreams);
    } catch {
      return buildServerFailureResponse(message, question, recursionAvailable);
    }
  }
}

export const dnsServer = new LabCoreDnsServer(
  {
    enabled: env.dnsServerEnabled,
    bindHost: env.dnsBindHost,
    port: env.dnsPort,
    hostsFilePath: env.generatedDnsHostsPath,
    rootDomain: env.rootDomain,
    upstreams: env.dnsUpstreams
  },
  (level, title, message) => {
    recordEvent({
      scope: "dns",
      level,
      title,
      message
    });
  }
);
