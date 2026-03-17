import type { ApplicationListItem, CreateApplicationPayload, DeleteMode, RegistrationFixture, SystemEvent, SystemStatus } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:7300";

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

export async function createApplication(payload: CreateApplicationPayload): Promise<void> {
  await requestJson("/api/applications", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function restartApplication(applicationId: string): Promise<void> {
  await requestJson(`/api/applications/${applicationId}/restart`, {
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
