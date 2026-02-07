export const taskStatuses = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function toStatusLabel(status: TaskStatus): string {
  switch (status) {
    case "todo":
      return "To do";
    case "in_progress":
      return "In progress";
    case "done":
      return "Done";
    default:
      return "";
  }
}
