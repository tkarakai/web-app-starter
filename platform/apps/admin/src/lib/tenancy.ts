/** Parse "19", "19.5" or "19.50" US dollars into whole cents; null when it isn't a price. */
export function parseDollars(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  return Math.round(Number(value.trim()) * 100);
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How long until a scheduled deletion: "in 9 days", "in 5 hours", "due now". */
export function countdown(deleteAt: number, now: number): string {
  const left = deleteAt - now;
  if (left <= 0) return "due now";
  if (left >= DAY_MS) {
    const days = Math.floor(left / DAY_MS);
    return `in ${days} day${days === 1 ? "" : "s"}`;
  }
  const hours = Math.max(1, Math.floor(left / HOUR_MS));
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}
