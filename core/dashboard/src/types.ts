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
    relay?: {
      required: boolean;
      targetHost: string;
      targetPort: number;
      udpReachable: boolean;
      tcpReachable: boolean;
      lastError: string | null;
    };
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
  envOverrides: Record<string, string>;
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

export type ComposeInspectionSource = {
  kind: "github" | "local";
  path: string;
  repositoryUrl?: string;
  branch?: string;
  blobUrl?: string;
  absolutePath?: string;
};

export type ComposeEnvironmentRequirement = {
  name: string;
  required: boolean;
  defaultValue: string | null;
  services: string[];
};

export type ComposeInspectionPayload = {
  composeCandidates: string[];
  yamlFiles: string[];
  recommendedComposePath: string | null;
  selectedComposePath: string;
  services: ComposeServiceCandidate[];
  environmentRequirements: ComposeEnvironmentRequirement[];
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

export type ImportComposeInspectResponse = ComposeInspectionPayload;

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

export type ApplicationDeployment = {
  deployment_id: string;
  compose_path: string;
  public_service_name: string;
  public_port: number;
  hostname: string;
  mode: "standard" | "headless";
  keep_volumes_on_rebuild: boolean;
  device_requirements: string[];
  env_overrides: Record<string, string>;
  enabled: boolean;
};

export type ApplicationRoute = {
  route_id: string;
  hostname: string;
  upstream_container: string | null;
  upstream_port: number;
  enabled: boolean;
};

export type ApplicationContainerInstance = {
  container_id: string;
  service_name: string;
  runtime_name: string;
  health_state: string;
  restart_count: number;
  last_seen_at: string;
};

export type ApplicationUpdateInfo = {
  current_commit: string | null;
  latest_remote_commit: string | null;
  has_update: boolean;
  checked_at: string;
};

export type ApplicationComposeInspection = ComposeInspectionPayload;

export type ApplicationDetail = {
  application: {
    application_id: string;
    name: string;
    description: string;
    repository_url: string;
    default_branch: string;
    current_commit: string | null;
    previous_commit: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  };
  deployment: ApplicationDeployment | null;
  composeInspection: ApplicationComposeInspection | null;
  routes: ApplicationRoute[];
  containers: ApplicationContainerInstance[];
  updateInfo: ApplicationUpdateInfo | null;
  events: SystemEvent[];
};

export type UpdateDeploymentPayload = {
  composePath: string;
  publicServiceName: string;
  publicPort: number;
  hostname: string;
  keepVolumesOnRebuild: boolean;
  envOverrides: Record<string, string>;
};
