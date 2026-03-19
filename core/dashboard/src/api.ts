import type {
  ApplicationComposeInspection,
  ApplicationDetail,
  ApplicationListItem,
  ApplicationLogsResponse,
  CreateApplicationResponse,
  CreateApplicationPayload,
  DeleteMode,
  ImportComposeInspectResponse,
  ImportResolveResponse,
  RegistrationFixture,
  SystemEvent,
  SystemStatus,
  UpdateDeploymentPayload
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message =
      typeof errorBody === "object" && errorBody && "message" in errorBody
        ? String(errorBody.message)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  return requestJson<SystemStatus>("/api/system/status");
}

export async function fetchApplications(): Promise<ApplicationListItem[]> {
  const response = await requestJson<{ applications: ApplicationListItem[] }>("/api/applications");
  return response.applications;
}

export async function fetchEvents(limit = 50): Promise<SystemEvent[]> {
  const response = await requestJson<{ events: SystemEvent[] }>(`/api/events?limit=${limit}`);
  return response.events;
}

export async function createApplication(payload: CreateApplicationPayload): Promise<CreateApplicationResponse> {
  return requestJson<CreateApplicationResponse>("/api/applications", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchApplicationDetail(applicationId: string): Promise<ApplicationDetail> {
  return requestJson<ApplicationDetail>(`/api/applications/${applicationId}`);
}

export async function updateApplicationDeployment(applicationId: string, payload: UpdateDeploymentPayload): Promise<void> {
  await requestJson(`/api/applications/${applicationId}/deployment`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function inspectApplicationDeploymentCompose(
  applicationId: string,
  composePath: string
): Promise<ApplicationComposeInspection> {
  return requestJson<ApplicationComposeInspection>(`/api/applications/${applicationId}/deployment/inspect`, {
    method: "POST",
    body: JSON.stringify({ composePath })
  });
}

export async function resolveImportSource(sourceUrl: string): Promise<ImportResolveResponse> {
  return requestJson<ImportResolveResponse>("/api/applications/import/resolve", {
    method: "POST",
    body: JSON.stringify({ sourceUrl })
  });
}

export async function inspectComposeFile(
  repositoryUrl: string,
  branch: string,
  composePath: string
): Promise<ImportComposeInspectResponse> {
  return requestJson<ImportComposeInspectResponse>("/api/applications/import/compose-inspect", {
    method: "POST",
    body: JSON.stringify({ repositoryUrl, branch, composePath })
  });
}

export async function restartApplication(applicationId: string): Promise<void> {
  await requestJson(`/api/applications/${applicationId}/restart`, {
    method: "POST"
  });
}

export async function stopApplication(applicationId: string): Promise<void> {
  await requestJson(`/api/applications/${applicationId}/stop`, {
    method: "POST"
  });
}

export async function resumeApplication(applicationId: string): Promise<void> {
  await requestJson(`/api/applications/${applicationId}/resume`, {
    method: "POST"
  });
}

export async function rebuildApplication(applicationId: string, keepData: boolean): Promise<void> {
  await requestJson(`/api/applications/${applicationId}/rebuild`, {
    method: "POST",
    body: JSON.stringify({ keepData })
  });
}

export async function checkUpdate(applicationId: string): Promise<void> {
  await requestJson(`/api/applications/${applicationId}/update-check`, {
    method: "POST"
  });
}

export async function applyUpdate(applicationId: string): Promise<void> {
  await requestJson(`/api/applications/${applicationId}/update`, {
    method: "POST"
  });
}

export async function rollbackApplication(applicationId: string): Promise<void> {
  await requestJson(`/api/applications/${applicationId}/rollback`, {
    method: "POST"
  });
}

export async function syncInfrastructure(reason = "dashboard"): Promise<void> {
  await requestJson(`/api/infrastructure/sync?reason=${encodeURIComponent(reason)}`, {
    method: "POST"
  });
}

export async function deleteApplication(applicationId: string, mode: DeleteMode): Promise<void> {
  await requestJson(`/api/applications/${applicationId}`, {
    method: "DELETE",
    body: JSON.stringify({ mode })
  });
}

export async function fetchRegistrationFixtures(): Promise<RegistrationFixture[]> {
  const response = await requestJson<{ fixtures: RegistrationFixture[] }>("/api/testing/registration-fixtures");
  return response.fixtures;
}

export async function fetchApplicationLogServices(applicationId: string): Promise<string[]> {
  const response = await requestJson<{ services: string[] }>(`/api/logs/${applicationId}/services`);
  return response.services;
}

export async function fetchApplicationLogs(
  applicationId: string,
  options: { service?: string; tail?: number } = {}
): Promise<ApplicationLogsResponse> {
  const params = new URLSearchParams();
  if (options.service) {
    params.set("service", options.service);
  }
  if (options.tail) {
    params.set("tail", String(options.tail));
  }
  const query = params.toString();
  const suffix = query.length > 0 ? `?${query}` : "";
  return requestJson<ApplicationLogsResponse>(`/api/logs/${applicationId}${suffix}`);
}
