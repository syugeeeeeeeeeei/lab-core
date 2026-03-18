function normalizeComposeSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/_+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[-_]+$/, "");
}

export function buildComposeProjectName(applicationId: string, applicationName: string): string {
  const normalizedName = normalizeComposeSegment(applicationName);
  if (normalizedName.length > 0) {
    return normalizedName;
  }

  const normalizedId = normalizeComposeSegment(applicationId);
  if (normalizedId.length > 0) {
    return `labcore-${normalizedId}`;
  }

  return "labcore-app";
}
