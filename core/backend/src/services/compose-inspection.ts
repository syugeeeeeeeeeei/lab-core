import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

export type ComposeServiceCandidate = {
  name: string;
  portOptions: number[];
  publishedPorts: number[];
  exposePorts: number[];
  detectedPublicPort: number | null;
  likelyPublic: boolean;
  reason: string;
};

export type ComposeInspectionSource = {
  kind: "github" | "local";
  path: string;
  repositoryUrl?: string;
  branch?: string;
  blobUrl?: string;
  absolutePath?: string;
};

export type RepositoryMetadata = {
  repositoryFiles: string[];
  yamlFiles: string[];
  composeCandidates: string[];
  recommendedComposePath: string | null;
};

export type ComposeInspectionResult = {
  composeCandidates: string[];
  yamlFiles: string[];
  recommendedComposePath: string | null;
  selectedComposePath: string;
  services: ComposeServiceCandidate[];
  environmentRequirements: Array<{
    name: string;
    required: boolean;
    defaultValue: string | null;
    services: string[];
  }>;
  serviceEnvironmentRequirements: Array<{
    serviceName: string;
    variables: Array<{
      name: string;
      required: boolean;
      defaultValue: string | null;
    }>;
  }>;
  detectedDeviceRequirements: string[];
  serviceDeviceRequirements: Array<{
    serviceName: string;
    devicePaths: string[];
  }>;
  rawYaml: string;
  parsedYaml: unknown | null;
  parseError: string | null;
  parseWarnings: string[];
  analysisWarnings: string[];
  source: ComposeInspectionSource;
};

type EnvironmentHints = Map<string, string>;

type PortCollection = {
  targetPorts: Set<number>;
  publishedPorts: Set<number>;
  exposePorts: Set<number>;
};

type EnvironmentRequirement = {
  name: string;
  required: boolean;
  defaultValue: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeJsonValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, entry]) => [String(key), normalizeJsonValue(entry)]));
  }
  if (value instanceof Set) {
    return [...value].map((entry) => normalizeJsonValue(entry));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeJsonValue(entry)]));
  }
  return String(value);
}

function formatYamlIssue(issue: { message: string }): string {
  return issue.message.trim();
}

function normalizeRelativePath(value: string): string {
  return value.trim().replace(/^\/+/, "");
}

export function isYamlFile(pathValue: string): boolean {
  return /\.ya?ml$/i.test(pathValue);
}

export function composeCandidateScore(pathValue: string): number {
  const normalized = pathValue.toLowerCase();
  const basename = normalized.split("/").pop() ?? normalized;
  let score = 0;

  if (normalized.startsWith("docker-compose.")) {
    score += 50;
  }
  if (normalized.startsWith("compose.")) {
    score += 45;
  }
  if (basename === "docker-compose.yml" || basename === "docker-compose.yaml") {
    score += 40;
  }
  if (basename === "compose.yml" || basename === "compose.yaml") {
    score += 35;
  }
  if (basename.includes("compose")) {
    score += 20;
  }
  if (!normalized.includes("/")) {
    score += 15;
  }

  return score;
}

export function collectRepositoryMetadataFromPaths(repositoryFiles: string[]): RepositoryMetadata {
  const uniqueRepositoryFiles = [...new Set(repositoryFiles)].sort((a, b) => a.localeCompare(b));
  const yamlFiles = [...new Set(uniqueRepositoryFiles.filter((filePath) => isYamlFile(filePath)))];
  const composeCandidates = [...new Set(yamlFiles.filter((filePath) => composeCandidateScore(filePath) > 0))].sort((a, b) => {
    const scoreDiff = composeCandidateScore(b) - composeCandidateScore(a);
    return scoreDiff !== 0 ? scoreDiff : a.localeCompare(b);
  });

  return {
    repositoryFiles: uniqueRepositoryFiles,
    yamlFiles,
    composeCandidates,
    recommendedComposePath: composeCandidates[0] ?? null
  };
}

export function listLocalRepositoryFiles(repoPath: string): string[] {
  const results: string[] = [];
  const ignoredDirectories = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo"]);
  const stack: string[] = [repoPath];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(repoPath, absolutePath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          stack.push(absolutePath);
        }
        continue;
      }

      results.push(relativePath);
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

function chooseDetectedPort(portOptions: number[]): number | null {
  const preferred = [80, 443, 3000, 8080, 8000, 5173, 4173, 5000, 8501, 8888];
  for (const port of preferred) {
    if (portOptions.includes(port)) {
      return port;
    }
  }
  return portOptions[0] ?? null;
}

export function sortComposeServices(services: ComposeServiceCandidate[]): ComposeServiceCandidate[] {
  return [...services].sort((a, b) => {
    if (a.likelyPublic !== b.likelyPublic) {
      return a.likelyPublic ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function chooseRecommendedComposeService(services: ComposeServiceCandidate[]): ComposeServiceCandidate | null {
  return services.find((service) => service.likelyPublic && service.detectedPublicPort !== null)
    ?? services.find((service) => service.detectedPublicPort !== null)
    ?? services[0]
    ?? null;
}

function buildServiceReason(name: string, portOptions: number[], likelyPublic: boolean): string {
  if (portOptions.length === 0) {
    return "ports / expose から公開候補ポートを検出できませんでした。";
  }
  if (likelyPublic) {
    return `サービス名 (${name}) と公開候補ポートから Web 公開候補と判断しました。`;
  }
  return "ports / expose から候補ポートを検出しました。";
}

function extractEnvironmentHints(serviceName: string, serviceValue: Record<string, unknown>, analysisWarnings: string[]): EnvironmentHints {
  const hints = new Map<string, string>();
  const environment = serviceValue.environment;

  if (environment === undefined || environment === null) {
    return hints;
  }

  if (Array.isArray(environment)) {
    for (const entry of environment) {
      if (typeof entry !== "string") {
        analysisWarnings.push(`service ${serviceName}: environment 配列に文字列以外の値があります。`);
        continue;
      }
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (key.length > 0) {
        hints.set(key, value);
      }
    }
    return hints;
  }

  if (!isRecord(environment)) {
    analysisWarnings.push(`service ${serviceName}: environment が object/array ではありません。`);
    return hints;
  }

  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      hints.set(key, String(value));
    }
  }

  return hints;
}

function resolvePlaceholderExpression(variableName: string, operator: string | undefined, fallback: string | undefined, envHints: EnvironmentHints, depth: number): string | null {
  if (depth > 5) {
    return null;
  }

  if (operator === ":-" || operator === "-") {
    return fallback ?? "";
  }

  const hintedValue = envHints.get(variableName);
  if (hintedValue === undefined) {
    return null;
  }

  return resolveTemplatedString(hintedValue, envHints, depth + 1).value;
}

function resolveTemplatedString(rawValue: string, envHints: EnvironmentHints, depth = 0): { value: string; unresolved: boolean } {
  let unresolved = false;
  const value = rawValue.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|\?:|\?|\+|:\+)([^}]*))?\}/g, (match, variableName, operator, fallback) => {
    if (operator === "+" || operator === ":+") {
      const hintedValue = envHints.get(variableName);
      if (hintedValue === undefined || hintedValue.length === 0) {
        return "";
      }
      return fallback ?? "";
    }
    if (operator === "?" || operator === "?:") {
      unresolved = true;
      return match;
    }

    const resolved = resolvePlaceholderExpression(variableName, operator, fallback, envHints, depth);
    if (resolved === null) {
      unresolved = true;
      return match;
    }
    return resolved;
  });

  return { value, unresolved };
}

function parsePortInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d{1,5}$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return parsed >= 1 && parsed <= 65535 ? parsed : null;
}

function parseTemplatedPortValue(rawValue: string | number, envHints: EnvironmentHints): { port: number | null; unresolved: boolean } {
  if (typeof rawValue === "number") {
    return { port: parsePortInteger(rawValue), unresolved: false };
  }

  const resolved = resolveTemplatedString(rawValue.trim().replace(/^['"]|['"]$/g, ""), envHints);
  const normalized = resolved.value.replace(/\/(tcp|udp)$/i, "");
  return {
    port: parsePortInteger(normalized),
    unresolved: resolved.unresolved
  };
}

function parseShortPortMapping(rawValue: string | number, envHints: EnvironmentHints): { target: number | null; published: number | null; unresolved: boolean } {
  if (typeof rawValue === "number") {
    return { target: parsePortInteger(rawValue), published: null, unresolved: false };
  }

  const resolved = resolveTemplatedString(rawValue.trim().replace(/^['"]|['"]$/g, "").replace(/\/(tcp|udp)$/i, ""), envHints);
  const normalized = resolved.value;

  if (!normalized.includes(":")) {
    return {
      target: parsePortInteger(normalized),
      published: null,
      unresolved: resolved.unresolved
    };
  }

  const segments = normalized.split(":");
  const target = parsePortInteger(segments[segments.length - 1] ?? "");
  let published: number | null = null;

  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const candidate = parsePortInteger(segments[index] ?? "");
    if (candidate !== null) {
      published = candidate;
      break;
    }
  }

  return { target, published, unresolved: resolved.unresolved };
}

function parseTemplatedPathValue(rawValue: unknown, envHints: EnvironmentHints): { path: string | null; unresolved: boolean } {
  if (typeof rawValue !== "string") {
    return { path: null, unresolved: false };
  }

  const resolved = resolveTemplatedString(rawValue.trim().replace(/^['"]|['"]$/g, ""), envHints);
  return {
    path: resolved.value.trim(),
    unresolved: resolved.unresolved
  };
}

function extractDevicePathCandidate(rawValue: string): string | null {
  const normalized = rawValue.trim();
  if (normalized.length === 0) {
    return null;
  }

  const segments = normalized.split(":");
  const firstSegment = segments[0]?.trim() ?? "";
  return firstSegment.startsWith("/dev/") ? firstSegment : null;
}

function recordEnvironmentRequirement(
  requirements: Map<string, EnvironmentRequirement>,
  input: {
    name: string;
    required: boolean;
    defaultValue: string | null;
  }
): void {
  const normalizedName = input.name.trim();
  if (normalizedName.length === 0) {
    return;
  }

  const existing = requirements.get(normalizedName);
  if (!existing) {
    requirements.set(normalizedName, {
      name: normalizedName,
      required: input.required,
      defaultValue: input.defaultValue
    });
    return;
  }

  existing.required = existing.required || input.required;
  if (existing.defaultValue === null && input.defaultValue !== null) {
    existing.defaultValue = input.defaultValue;
  }
}

function scanStringForEnvironmentRequirements(
  rawValue: string,
  requirements: Map<string, EnvironmentRequirement>
): void {
  const normalized = rawValue.trim();
  if (normalized.length === 0) {
    return;
  }

  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|\?:|\?|\+|:\+)([^}]*))?\}/g;
  for (const match of normalized.matchAll(pattern)) {
    const variableName = match[1] ?? "";
    const operator = match[2];
    const fallback = match[3] ?? null;

    if (operator === ":-" || operator === "-") {
      if (fallback === "") {
        recordEnvironmentRequirement(requirements, {
          name: variableName,
          required: true,
          defaultValue: null
        });
        continue;
      }

      recordEnvironmentRequirement(requirements, {
        name: variableName,
        required: false,
        defaultValue: fallback
      });
      continue;
    }

    if (operator === "+" || operator === ":+") {
      recordEnvironmentRequirement(requirements, {
        name: variableName,
        required: false,
        defaultValue: null
      });
      continue;
    }

    recordEnvironmentRequirement(requirements, {
      name: variableName,
      required: true,
      defaultValue: null
    });
  }
}

function scanObjectForEnvironmentRequirements(
  value: unknown,
  requirements: Map<string, EnvironmentRequirement>
): void {
  if (typeof value === "string") {
    scanStringForEnvironmentRequirements(value, requirements);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      scanObjectForEnvironmentRequirements(entry, requirements);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const entry of Object.values(value)) {
    scanObjectForEnvironmentRequirements(entry, requirements);
  }
}

function collectEnvironmentRequirementCandidates(
  serviceName: string,
  serviceValue: Record<string, unknown>,
  analysisWarnings: string[]
): EnvironmentRequirement[] {
  const requirements = new Map<string, EnvironmentRequirement>();
  scanObjectForEnvironmentRequirements(serviceValue, requirements);

  const environment = serviceValue.environment;
  if (Array.isArray(environment)) {
    for (const entry of environment) {
      if (typeof entry !== "string") {
        analysisWarnings.push(`service ${serviceName}: environment 配列に文字列以外の値があります。`);
        continue;
      }

      const normalizedEntry = entry.trim();
      if (normalizedEntry.length === 0) {
        continue;
      }

      const separatorIndex = normalizedEntry.indexOf("=");
      if (separatorIndex < 0) {
        recordEnvironmentRequirement(requirements, {
          name: normalizedEntry,
          required: true,
          defaultValue: null
        });
      }
    }
  } else if (isRecord(environment)) {
    for (const [key, value] of Object.entries(environment)) {
      if (value === null) {
        recordEnvironmentRequirement(requirements, {
          name: key,
          required: true,
          defaultValue: null
        });
      }
    }
  }

  return [...requirements.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectDeviceRequirementCandidates(
  serviceName: string,
  serviceValue: Record<string, unknown>,
  envHints: EnvironmentHints,
  analysisWarnings: string[]
): string[] {
  const devicePaths = new Set<string>();

  const devices = serviceValue.devices;
  if (devices !== undefined && devices !== null) {
    const entries = Array.isArray(devices) ? devices : [devices];
    for (const entry of entries) {
      if (typeof entry === "string") {
        const resolved = parseTemplatedPathValue(entry, envHints);
        const candidate = resolved.path ? extractDevicePathCandidate(resolved.path) : null;
        if (candidate) {
          devicePaths.add(candidate);
        } else if (resolved.unresolved) {
          analysisWarnings.push(`service ${serviceName}: devices の値 ${entry} を解決できませんでした。`);
        }
        continue;
      }

      if (isRecord(entry)) {
        for (const key of ["source", "path"]) {
          const resolved = parseTemplatedPathValue(entry[key], envHints);
          if (resolved.path?.startsWith("/dev/")) {
            devicePaths.add(resolved.path);
            break;
          }
        }
        continue;
      }

      analysisWarnings.push(`service ${serviceName}: devices に未対応の値があります。`);
    }
  }

  const volumes = serviceValue.volumes;
  if (volumes !== undefined && volumes !== null) {
    const entries = Array.isArray(volumes) ? volumes : [volumes];
    for (const entry of entries) {
      if (typeof entry === "string") {
        const resolved = parseTemplatedPathValue(entry, envHints);
        const candidate = resolved.path ? extractDevicePathCandidate(resolved.path) : null;
        if (candidate) {
          devicePaths.add(candidate);
        }
        continue;
      }

      if (isRecord(entry)) {
        const source = parseTemplatedPathValue(entry.source, envHints);
        if (source.path?.startsWith("/dev/")) {
          devicePaths.add(source.path);
        }
      }
    }
  }

  return [...devicePaths].sort((a, b) => a.localeCompare(b));
}

function normalizePortEntries(
  serviceName: string,
  fieldName: "ports" | "expose",
  value: unknown,
  envHints: EnvironmentHints,
  collected: PortCollection,
  analysisWarnings: string[]
): void {
  if (value === undefined || value === null) {
    return;
  }

  const entries = Array.isArray(value) ? value : [value];

  for (const entry of entries) {
    if (fieldName === "ports") {
      if (typeof entry === "string" || typeof entry === "number") {
        const parsed = parseShortPortMapping(entry, envHints);
        if (parsed.target !== null) {
          collected.targetPorts.add(parsed.target);
        }
        if (parsed.published !== null) {
          collected.publishedPorts.add(parsed.published);
        }
        if (parsed.unresolved && parsed.target === null && parsed.published === null) {
          analysisWarnings.push(`service ${serviceName}: ports の値 ${String(entry)} を解決できませんでした。`);
        }
        continue;
      }

      if (isRecord(entry)) {
        const target = parseTemplatedPortValue(entry.target as string | number, envHints);
        const published = parseTemplatedPortValue(entry.published as string | number, envHints);
        if (target.port !== null) {
          collected.targetPorts.add(target.port);
        }
        if (published.port !== null) {
          collected.publishedPorts.add(published.port);
        }
        if ((target.unresolved || published.unresolved) && target.port === null && published.port === null) {
          analysisWarnings.push(`service ${serviceName}: long syntax ports を解決できませんでした。`);
        }
        continue;
      }

      analysisWarnings.push(`service ${serviceName}: ports に未対応の値があります。`);
      continue;
    }

    if (typeof entry === "string" || typeof entry === "number") {
      const parsed = parseTemplatedPortValue(entry, envHints);
      if (parsed.port !== null) {
        collected.exposePorts.add(parsed.port);
      } else if (parsed.unresolved) {
        analysisWarnings.push(`service ${serviceName}: expose の値 ${String(entry)} を解決できませんでした。`);
      }
      continue;
    }

    analysisWarnings.push(`service ${serviceName}: expose に未対応の値があります。`);
  }
}

function analyzeComposeServices(parsedYaml: unknown): {
  services: ComposeServiceCandidate[];
  environmentRequirements: Array<{
    name: string;
    required: boolean;
    defaultValue: string | null;
    services: string[];
  }>;
  serviceEnvironmentRequirements: Array<{
    serviceName: string;
    variables: Array<{
      name: string;
      required: boolean;
      defaultValue: string | null;
    }>;
  }>;
  analysisWarnings: string[];
  detectedDeviceRequirements: string[];
  serviceDeviceRequirements: Array<{
    serviceName: string;
    devicePaths: string[];
  }>;
} {
  const analysisWarnings: string[] = [];

  if (!isRecord(parsedYaml)) {
    return {
      services: [],
      environmentRequirements: [],
      serviceEnvironmentRequirements: [],
      analysisWarnings: ["YAML のルートが object ではありません。"],
      detectedDeviceRequirements: [],
      serviceDeviceRequirements: []
    };
  }

  const servicesValue = parsedYaml.services;
  if (servicesValue === undefined) {
    return {
      services: [],
      environmentRequirements: [],
      serviceEnvironmentRequirements: [],
      analysisWarnings: ["services ルートが見つかりません。"],
      detectedDeviceRequirements: [],
      serviceDeviceRequirements: []
    };
  }

  if (!isRecord(servicesValue)) {
    return {
      services: [],
      environmentRequirements: [],
      serviceEnvironmentRequirements: [],
      analysisWarnings: ["services ルートが object ではありません。"],
      detectedDeviceRequirements: [],
      serviceDeviceRequirements: []
    };
  }

  const services: ComposeServiceCandidate[] = [];
  const environmentRequirements = new Map<string, { name: string; required: boolean; defaultValue: string | null; services: Set<string> }>();
  const serviceEnvironmentRequirements: Array<{
    serviceName: string;
    variables: Array<{
      name: string;
      required: boolean;
      defaultValue: string | null;
    }>;
  }> = [];
  const detectedDeviceRequirements = new Set<string>();
  const serviceDeviceRequirements: Array<{ serviceName: string; devicePaths: string[] }> = [];

  for (const [serviceName, serviceValue] of Object.entries(servicesValue)) {
    if (!isRecord(serviceValue)) {
      analysisWarnings.push(`service ${serviceName}: 定義が object ではありません。`);
      services.push({
        name: serviceName,
        portOptions: [],
        publishedPorts: [],
        exposePorts: [],
        detectedPublicPort: null,
        likelyPublic: /web|app|frontend|front|ui|http|nginx|caddy|server/i.test(serviceName),
        reason: "サービス定義を object として解釈できませんでした。"
      });
      continue;
    }

    const envHints = extractEnvironmentHints(serviceName, serviceValue, analysisWarnings);
    const serviceEnvironmentVariables = collectEnvironmentRequirementCandidates(serviceName, serviceValue, analysisWarnings);
    const serviceDevices = collectDeviceRequirementCandidates(serviceName, serviceValue, envHints, analysisWarnings);
    const collected: PortCollection = {
      targetPorts: new Set<number>(),
      publishedPorts: new Set<number>(),
      exposePorts: new Set<number>()
    };

    normalizePortEntries(serviceName, "ports", serviceValue.ports, envHints, collected, analysisWarnings);
    normalizePortEntries(serviceName, "expose", serviceValue.expose, envHints, collected, analysisWarnings);

    const portOptions = [...new Set([...collected.targetPorts, ...collected.exposePorts])].sort((a, b) => a - b);
    const publishedPorts = [...collected.publishedPorts].sort((a, b) => a - b);
    const exposePorts = [...collected.exposePorts].sort((a, b) => a - b);
    const hasNameHint = /web|app|frontend|front|ui|http|nginx|caddy|server/i.test(serviceName);
    const detectedPublicPort = chooseDetectedPort(portOptions);
    const likelyPublic = hasNameHint || (detectedPublicPort !== null && [80, 443, 3000, 8080, 8000, 5173].includes(detectedPublicPort));

    services.push({
      name: serviceName,
      portOptions,
      publishedPorts,
      exposePorts,
      detectedPublicPort,
      likelyPublic,
      reason: buildServiceReason(serviceName, portOptions, likelyPublic)
    });

    if (serviceEnvironmentVariables.length > 0) {
      serviceEnvironmentRequirements.push({
        serviceName,
        variables: serviceEnvironmentVariables
      });
      for (const variable of serviceEnvironmentVariables) {
        const existing = environmentRequirements.get(variable.name);
        if (!existing) {
          environmentRequirements.set(variable.name, {
            name: variable.name,
            required: variable.required,
            defaultValue: variable.defaultValue,
            services: new Set([serviceName])
          });
          continue;
        }

        existing.required = existing.required || variable.required;
        if (existing.defaultValue === null && variable.defaultValue !== null) {
          existing.defaultValue = variable.defaultValue;
        }
        existing.services.add(serviceName);
      }
    }

    if (serviceDevices.length > 0) {
      serviceDeviceRequirements.push({
        serviceName,
        devicePaths: serviceDevices
      });
      for (const devicePath of serviceDevices) {
        detectedDeviceRequirements.add(devicePath);
      }
    }
  }

  return {
    services: sortComposeServices(services),
    environmentRequirements: [...environmentRequirements.values()]
      .map((entry) => ({
        name: entry.name,
        required: entry.required,
        defaultValue: entry.defaultValue,
        services: [...entry.services].sort((a, b) => a.localeCompare(b))
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    serviceEnvironmentRequirements,
    analysisWarnings,
    detectedDeviceRequirements: [...detectedDeviceRequirements].sort((a, b) => a.localeCompare(b)),
    serviceDeviceRequirements
  };
}

export function inspectComposeYaml(input: {
  rawYaml: string;
  composeCandidates?: string[];
  yamlFiles?: string[];
  recommendedComposePath?: string | null;
  selectedComposePath: string;
  source: ComposeInspectionSource;
}): ComposeInspectionResult {
  const document = parseDocument(input.rawYaml, {
    merge: true,
    prettyErrors: false,
    uniqueKeys: false
  });

  const parseWarnings = document.warnings.map((warning) => formatYamlIssue(warning));
  const parseErrors = document.errors.map((error) => formatYamlIssue(error));
  const parseError = parseErrors.length > 0 ? parseErrors.join("\n") : null;
  const parsedYaml = parseError ? null : normalizeJsonValue(document.toJS({ maxAliasCount: 100 })) ?? null;
  const {
    services,
    environmentRequirements,
    serviceEnvironmentRequirements,
    analysisWarnings,
    detectedDeviceRequirements,
    serviceDeviceRequirements
  } = parseError
    ? {
        services: [],
        environmentRequirements: [],
        serviceEnvironmentRequirements: [],
        analysisWarnings: [],
        detectedDeviceRequirements: [],
        serviceDeviceRequirements: []
      }
    : analyzeComposeServices(parsedYaml);

  return {
    composeCandidates: input.composeCandidates ?? [],
    yamlFiles: input.yamlFiles ?? [],
    recommendedComposePath: input.recommendedComposePath ?? null,
    selectedComposePath: input.selectedComposePath,
    services,
    environmentRequirements,
    serviceEnvironmentRequirements,
    detectedDeviceRequirements,
    serviceDeviceRequirements,
    rawYaml: input.rawYaml,
    parsedYaml,
    parseError,
    parseWarnings,
    analysisWarnings,
    source: input.source
  };
}

export function inspectComposeFile(input: {
  absolutePath: string;
  composeCandidates?: string[];
  yamlFiles?: string[];
  recommendedComposePath?: string | null;
  selectedComposePath: string;
  source?: Omit<ComposeInspectionSource, "kind" | "path" | "absolutePath">;
}): ComposeInspectionResult {
  const rawYaml = fs.readFileSync(input.absolutePath, "utf8");
  return inspectComposeYaml({
    rawYaml,
    composeCandidates: input.composeCandidates,
    yamlFiles: input.yamlFiles,
    recommendedComposePath: input.recommendedComposePath,
    selectedComposePath: input.selectedComposePath,
    source: {
      kind: "local",
      path: input.selectedComposePath,
      absolutePath: input.absolutePath,
      ...input.source
    }
  });
}

export function buildUnavailableComposeInspection(input: {
  composeCandidates?: string[];
  yamlFiles?: string[];
  recommendedComposePath?: string | null;
  selectedComposePath: string;
  source: ComposeInspectionSource;
  message: string;
  fallbackServices?: ComposeServiceCandidate[];
}): ComposeInspectionResult {
  return {
    composeCandidates: input.composeCandidates ?? [],
    yamlFiles: input.yamlFiles ?? [],
    recommendedComposePath: input.recommendedComposePath ?? null,
    selectedComposePath: input.selectedComposePath,
    services: input.fallbackServices ?? [],
    environmentRequirements: [],
    serviceEnvironmentRequirements: [],
    detectedDeviceRequirements: [],
    serviceDeviceRequirements: [],
    rawYaml: "",
    parsedYaml: null,
    parseError: input.message,
    parseWarnings: [],
    analysisWarnings: [],
    source: input.source
  };
}

export function buildFallbackServiceCandidate(serviceName: string, publicPort: number): ComposeServiceCandidate {
  const normalizedPort = Number.isInteger(publicPort) && publicPort > 0 ? publicPort : 80;

  return {
    name: serviceName,
    portOptions: [normalizedPort],
    publishedPorts: [],
    exposePorts: [normalizedPort],
    detectedPublicPort: normalizedPort,
    likelyPublic: true,
    reason: "現在の保存済み設定を候補として表示しています。"
  };
}

export function validateComposeServiceSelection(result: ComposeInspectionResult, serviceName: string, composePath: string): void {
  const normalizedComposePath = normalizeRelativePath(composePath);

  if (result.selectedComposePath !== normalizedComposePath) {
    throw new Error(`compose 候補に存在しません: ${composePath}`);
  }

  if (result.parseError) {
    throw new Error(result.parseError);
  }

  if (!result.services.some((service) => service.name === serviceName)) {
    throw new Error(`compose 内に存在しないサービスです: ${serviceName}`);
  }
}

export function validateEnvironmentOverrides(result: ComposeInspectionResult, envOverrides: Record<string, string>): void {
  if (result.parseError) {
    throw new Error(result.parseError);
  }

  const missingRequired = result.environmentRequirements.filter((requirement) => {
    if (!requirement.required) {
      return false;
    }

    const value = envOverrides[requirement.name];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missingRequired.length === 0) {
    return;
  }

  throw new Error(
    `必須環境変数が未設定です: ${missingRequired.map((requirement) => requirement.name).join(", ")}`
  );
}
