// Helper utilities for consistent formatting in the starter.
export function formatTaskStatus(status: string) {
  const normalized = status.trim().toLowerCase();

  if (!normalized) {
    return "Unspecified";
  }

  return normalized.replace(/(^\w|\s\w)/g, (match) => match.toUpperCase());
}
