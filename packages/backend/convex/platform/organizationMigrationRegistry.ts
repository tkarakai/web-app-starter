import { sha256Hex } from "./tokenHash";

/** App registrations are code reviewed, versioned input, never client-supplied authority. */
export interface OrganizationMigrationRegistry {
  version: number;
  tables: Record<string, "private-root" | "private-child" | "identity-private" | "platform-control" | "authority-retire" | "artifact-quarantine" | "migration-bookkeeping">;
  functions: Record<string, "tenant" | "legacy-retired" | "identity-private" | "platform-control" | "migration-internal">;
  jobs: Record<string, "cancel" | "drain" | "preserve-control" | "epoch-control">;
  components: Record<string, string>;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}
export function organizationMigrationFingerprint(value: unknown): string { return sha256Hex(canonical(value)); }
export function organizationRegistryHash(registry: OrganizationMigrationRegistry): string {
  return sha256Hex(canonical(registry));
}
/** Inventory is independently derived from the deployed schema/source by the app/deploy tooling. */
export function assertOrganizationInventory(registry: OrganizationMigrationRegistry, inventory: { tables: string[]; functions: string[]; jobs: string[] }) {
  for (const kind of ["tables", "functions", "jobs"] as const) {
    const expected = [...inventory[kind]].sort();
    const actual = Object.keys(registry[kind]).sort();
    if (new Set(expected).size !== expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new Error(`ORGANIZATION_UNCLASSIFIED_${kind.toUpperCase()}:${expected.filter(name => !actual.includes(name)).join(",")}:${actual.filter(name => !expected.includes(name)).join(",")}`);
    }
  }
}
