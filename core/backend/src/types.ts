export type ApplicationStatus =
  | "Draft"
  | "Cloning"
  | "Build Pending"
  | "Deploying"
  | "Running"
  | "Degraded"
  | "Stopped"
  | "Failed"
  | "Rebuilding"
  | "Deleting";

export type DeploymentMode = "standard" | "headless";

export type EventLevel = "info" | "warning" | "error";

export type JobType =
  | "clone"
  | "build"
  | "deploy"
  | "stop"
  | "resume"
  | "rebuild"
  | "delete"
  | "update"
  | "rollback"
  | "restart";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";
