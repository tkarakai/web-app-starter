// Downstream-owned: foundation releases must never replace these business rules.
export const business = {
  name: "Northstar Dispatch",
  description: "Regional freight, ready for the next mile.",
  priorityThresholdKg: 800,
} as const;

export interface Load {
  reference: string;
  destination: string;
  weightKg: number;
  ready: boolean;
}

export const loads: Load[] = [
  { reference: "NS-104", destination: "Port of Oakland", weightKg: 1200, ready: true },
  { reference: "NS-105", destination: "Sacramento depot", weightKg: 450, ready: true },
  { reference: "NS-106", destination: "Fresno cold storage", weightKg: 900, ready: false },
];

/** Heavy freight gets the first ready slot; unready loads must never be dispatched. */
export function dispatchQueue(items: readonly Load[]): Load[] {
  return items.filter((item) => item.ready).toSorted((a, b) =>
    Number(b.weightKg >= business.priorityThresholdKg) - Number(a.weightKg >= business.priorityThresholdKg)
    || a.reference.localeCompare(b.reference),
  );
}
