export function snapshot(row: Record<string, unknown>): string {
  const ignored = new Set(["_id", "_creationTime", "publishJobId", "unpublishJobId", "pendingPublishAt", "pendingUnpublishAt", "legacyId", "legacyCreationTime"]);
  return JSON.stringify(Object.fromEntries(Object.entries(row)
    .filter(([key, value]) => !ignored.has(key) && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))));
}

