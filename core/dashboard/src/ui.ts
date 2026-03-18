export function toLocale(value: string): string {
  try {
    return new Date(value).toLocaleString("ja-JP");
  } catch {
    return value;
  }
}

export function statusBadgeClass(status: string): string {
  if (status === "Running") {
    return "badge badge-ok";
  }
  if (status === "Degraded") {
    return "badge badge-warn";
  }
  if (status === "Failed") {
    return "badge badge-error";
  }
  return "badge";
}

export function jobStatusBadgeClass(status: string | null | undefined): string {
  if (status === "succeeded") {
    return "badge badge-ok";
  }
  if (status === "failed") {
    return "badge badge-error";
  }
  if (status === "queued" || status === "running") {
    return "badge badge-warn";
  }
  return "badge";
}

export function shortCommit(value: string | null): string {
  if (!value) {
    return "未取得";
  }
  return value.length > 12 ? value.slice(0, 12) : value;
}

export function logLineClass(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("error") || lower.includes("failed") || lower.includes("exception")) {
    return "log-line error";
  }
  if (lower.includes("warn")) {
    return "log-line warning";
  }
  return "log-line";
}
