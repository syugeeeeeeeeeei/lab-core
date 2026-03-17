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
};

export type SystemEvent = {
  event_id: string;
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
