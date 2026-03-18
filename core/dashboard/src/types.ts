export type SystemStatus = {
  generatedAt: string;
  applicationSummary: {
    total: number;
    running: number;
    degraded: number;
    failed: number;
  };
  jobSummary: {
    queued: number;
    running: number;
  };
  execution?: {
    mode: "dry-run" | "execute";
    mainServiceIp: string;
    sshServiceIp: string;
    rootDomain: string;
  };
  dnsServer?: {
    enabled: boolean;
    bindHost: string;
    port: number;
    hostsFilePath: string;
    upstreams: string[];
    udpListening: boolean;
    tcpListening: boolean;
    lastError: string | null;
  };
};

export type ApplicationListItem = {
  application_id: string;
  name: string;
  description: string;
  repository_url: string;
  default_branch: string;
  current_commit: string | null;
  previous_commit: string | null;
  status: string;
  hostname: string;
  public_port: number;
  public_service_name: string;
  mode: "standard" | "headless";
  has_update: boolean;
  updated_at: string;
  latest_error_title?: string | null;
  latest_error_message?: string | null;
  latest_error_at?: string | null;
  latest_job_type?: string | null;
  latest_job_status?: "queued" | "running" | "succeeded" | "failed" | null;
  latest_job_message?: string | null;
  latest_job_created_at?: string | null;
  latest_job_started_at?: string | null;
  latest_job_finished_at?: string | null;
};

export type SystemEvent = {
  event_id: string;
  scope?: string;
  application_id?: string | null;
  application_name?: string | null;
  level: "info" | "warning" | "error";
  title: string;
  message: string;
  created_at: string;
};

export type CreateApplicationPayload = {
  name: string;
  description: string;
  repositoryUrl: string;
  defaultBranch: string;
  composePath: string;
  publicServiceName: string;
  publicPort: number;
  hostname: string;
  mode: "standard" | "headless";
  keepVolumesOnRebuild: boolean;
  deviceRequirements: string[];
};

export type CreateApplicationResponse = {
  applicationId: string;
  deploymentId: string;
  routeId: string;
  jobId: string;
  message: string;
};

export type ImportResolveResponse = {
  canonicalRepositoryUrl: string;
  resolvedBranch: string;
  branchFixed: boolean;
  branchCandidates: string[];
  repositoryFiles: string[];
  yamlFiles: string[];
  composeCandidates: string[];
  recommendedComposePath: string | null;
  warning?: string;
};

export type ComposeServiceCandidate = {
  name: string;
  portOptions: number[];
  publishedPorts: number[];
  exposePorts: number[];
  detectedPublicPort: number | null;
  likelyPublic: boolean;
  reason: string;
};

export type ImportComposeInspectResponse = {
  composePath: string;
  services: ComposeServiceCandidate[];
  warning?: string;
};

export type DeleteMode = "config_only" | "source_and_config" | "full";

export type RegistrationFixture = {
  id: string;
  label: string;
  payload: CreateApplicationPayload;
};

export type ApplicationLogsResponse = {
  applicationId: string;
  applicationName: string;
  service: string | null;
  tail: number;
  lines: string[];
  fetchedAt: string;
  executionMode: "dry-run" | "execute";
};
