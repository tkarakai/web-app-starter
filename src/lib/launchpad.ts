export const launchStatuses = ["idea", "building", "shipping"] as const;
export type LaunchStatus = (typeof launchStatuses)[number];

export function normalizeTitle(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function toPriorityLabel(priority: number) {
  if (priority >= 4) return "Must";
  if (priority >= 3) return "Should";
  if (priority >= 2) return "Could";
  return "Nice";
}

export function toStatusCopy(status: LaunchStatus) {
  switch (status) {
    case "idea":
      return "Idea pool";
    case "building":
      return "In build";
    case "shipping":
      return "Ready to ship";
    default:
      return "";
  }
}
