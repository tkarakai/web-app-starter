/** Offline declaration comparison. No resolution, compatibility inference, or IO. */
import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectValue = { [key: string]: Json };
export interface Snapshot {
  schemaVersion: 1;
  claimedStarterIdentity?: ObjectValue;
  manifests: Record<string, ObjectValue>;
}
const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const policies = ["overrides", "resolutions", "engines", "devEngines", "packageManager", "workspaces", "peerDependenciesMeta", "catalog", "catalogs", "os", "cpu", "libc"] as const;
const own = (object: ObjectValue, key: string): Json | undefined => Object.hasOwn(object, key) ? object[key] : undefined;
function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requireObject(value: unknown, label: string): asserts value is ObjectValue {
  if (!object(value)) throw new Error(`${label} must be an object`);
}
function strings(value: unknown, label: string): void {
  requireObject(value, label);
  for (const [key, spec] of Object.entries(value)) {
    if (!key.trim() || typeof spec !== "string" || !spec.trim()) throw new Error(`${label}.${key} must be a nonempty string`);
  }
}

/** Canonical JSON: object keys sorted by code unit, array order and raw strings retained. */
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: Json): string { return createHash("sha256").update(canonical(value)).digest("hex"); }

/** Reject duplicate JSON keys before they can silently erase a manifest or policy. */
export function parseSnapshot(text: string): Snapshot {
  const value: unknown = JSON.parse(text, (_key: string, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite JSON number");
    return value;
  });
  const stack: (Set<string> | null)[] = [];
  const token = /"(?:[^"\\]|\\.)*"/y;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") stack.push(new Set());
    else if (text[i] === "[") stack.push(null);
    else if (text[i] === "}" || text[i] === "]") stack.pop();
    else if (text[i] === '"') {
      token.lastIndex = i;
      const match = token.exec(text)!; // JSON.parse already validated string syntax.
      i = token.lastIndex - 1;
      let next = i + 1;
      while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      if (text[next] === ":") {
        const key = JSON.parse(match[0]) as string;
        const keys = stack.at(-1)!;
        if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
        keys.add(key);
      }
    }
  }
  validateSnapshot(value);
  return value;
}

/** Validate caller-supplied data; no path is opened or expanded by this module. */
export function validateSnapshot(value: unknown): asserts value is Snapshot {
  requireObject(value, "snapshot");
  if (value.schemaVersion !== 1) throw new Error("Unsupported snapshot schemaVersion (expected 1)");
  for (const key of Object.keys(value)) {
    if (!["schemaVersion", "claimedStarterIdentity", "manifests"].includes(key)) throw new Error(`Unsupported snapshot field: ${key}`);
  }
  if (Object.hasOwn(value, "claimedStarterIdentity")) requireObject(value.claimedStarterIdentity, "claimedStarterIdentity");
  requireObject(value.manifests, "manifests");
  if (!Object.hasOwn(value.manifests, "package.json")) throw new Error("manifests must explicitly include root package.json");
  for (const [file, manifest] of Object.entries(value.manifests)) {
    const parts = file.split("/");
    if (parts.at(-1) !== "package.json" || parts.some(p => !p || p === "." || p === ".." || /[\\:]/.test(p) || [...p].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) {
      throw new Error(`Manifest path must be a normalized relative package.json path: ${file}`);
    }
    requireObject(manifest, file);
    for (const section of sections) if (Object.hasOwn(manifest, section)) strings(manifest[section], `${file}.${section}`);
    for (const field of ["name", "packageManager"]) {
      const fieldValue = own(manifest, field);
      if (fieldValue !== undefined && (typeof fieldValue !== "string" || !fieldValue.trim())) throw new Error(`${file}.${field} must be a nonempty string`);
    }
    if (Object.hasOwn(manifest, "engines")) strings(manifest.engines, `${file}.engines`);
    for (const field of ["overrides", "resolutions", "devEngines", "peerDependenciesMeta", "catalog", "catalogs"]) {
      if (Object.hasOwn(manifest, field)) requireObject(manifest[field], `${file}.${field}`);
    }
    if (object(manifest.peerDependenciesMeta)) {
      for (const [name, metadata] of Object.entries(manifest.peerDependenciesMeta)) {
        requireObject(metadata, `${file}.peerDependenciesMeta.${name}`);
        if (Object.hasOwn(metadata, "optional") && typeof metadata.optional !== "boolean") throw new Error(`${file}.peerDependenciesMeta.${name}.optional must be boolean`);
      }
    }
    const workspaces = own(manifest, "workspaces");
    if (workspaces !== undefined && !object(workspaces) && !(Array.isArray(workspaces) && workspaces.every(p => typeof p === "string" && p.trim()))) {
      throw new Error(`${file}.workspaces must be a string array or opaque policy object`);
    }
  }
}

type Classification = "unchanged" | "upstream-only" | "downstream-only" | "converged" | "divergent" | "inventory-equal" | "inventory-different";
function classify(a: Json, b: Json, c: Json, hasBase: boolean): Classification {
  const ab = canonical(a) === canonical(b), ac = canonical(a) === canonical(c), bc = canonical(b) === canonical(c);
  if (!hasBase) return bc ? "inventory-equal" : "inventory-different";
  if (ab && ac) return "unchanged";
  if (bc) return "converged";
  if (ab) return "upstream-only";
  if (ac) return "downstream-only";
  return "divergent";
}
const stable = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?![\s\S])/;
function direction(from: string | null, to: string | null): string {
  if (from === null || to === null) return "absent";
  if (!stable.test(from) || !stable.test(to)) return "unsupported";
  const left = from.split(".").map(BigInt), right = to.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? "increase" : "decrease";
  return "equal";
}
function specKind(spec: string | null): string {
  if (spec === null) return "absent";
  if (stable.test(spec)) return "exact-stable";
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec) ? "opaque-protocol" : "opaque-spec";
}
function dependency(manifest: ObjectValue | undefined, section: string, name: string): string | null {
  const map = manifest && own(manifest, section);
  return object(map) && Object.hasOwn(map, name) ? map[name] as string : null;
}
function manifestAt(snapshot: Snapshot | undefined, file: string): ObjectValue | undefined {
  return snapshot && Object.hasOwn(snapshot.manifests, file) ? snapshot.manifests[file] : undefined;
}

/** Compare snapshots without changing them; B remains the current choice even for candidate C edits. */
export function compareDependencies(base: Snapshot | undefined, downstream: Snapshot, target: Snapshot) {
  for (const snapshot of [base, downstream, target]) if (snapshot !== undefined) validateSnapshot(snapshot);
  const hasBase = base !== undefined;
  const snapshots = [base, downstream, target];
  const files = [...new Set(snapshots.flatMap(s => s ? Object.keys(s.manifests) : []))].sort();
  const identities = snapshots.map(s => s?.claimedStarterIdentity ?? null);
  const inputHashes = { base: base ? hash(base as unknown as Json) : null, downstream: hash(downstream as unknown as Json), target: hash(target as unknown as Json) };
  const workspaces = files.map(file => {
    const manifests = snapshots.map(s => manifestAt(s, file));
    const suppliedManifests = hasBase ? manifests : manifests.slice(1);
    const [a, b, c] = manifests;
    const reviewReasons: string[] = [];
    if (suppliedManifests.some(m => !m)) reviewReasons.push("workspace-mapping-review");
    const names = manifests.map(m => m ? own(m, "name") ?? null : null);
    if (new Set(suppliedManifests.map(m => canonical(m ? own(m, "name") ?? null : null))).size > 1) reviewReasons.push("workspace-name-review");
    if (snapshots.some(s => s && Object.values(s.manifests).filter(m => typeof m.name === "string" && m.name === (manifestAt(s, file)?.name)).length > 1)) reviewReasons.push("duplicate-workspace-name");
    const entries = sections.flatMap(section => {
      const names = [...new Set(manifests.flatMap(m => m && object(own(m, section)) ? Object.keys(m[section] as ObjectValue) : []))].sort();
      return names.map(name => {
        const values = manifests.map(m => dependency(m, section, name));
        const [A, B, C] = values;
        const classification = classify(A, B, C, hasBase);
        const reasons: string[] = [];
        if (section === "peerDependencies") reasons.push("peer-constraints-not-assessed");
        if (values.some(v => v !== null && !stable.test(v))) reasons.push("semantic-assessment-unsupported");
        if (classification === "divergent") reasons.push("intent-conflict");
        if (classification === "upstream-only") reasons.push(C === null ? "removal-usage-review" : "candidate-requires-review");
        if (!hasBase) reasons.push("base-missing");
        if (B !== null && C !== null && direction(B, C) === "decrease") reasons.push("target-lower-than-downstream");
        if (manifests.some(m => m && sections.filter(s => dependency(m, s, name) !== null).length > 1)) reasons.push("multiple-sections-review");
        if (new Set(suppliedManifests.map(m => sections.filter(s => dependency(m, s, name) !== null).join(","))).size > 1
          && manifests.some(m => m && sections.some(s => s !== section && dependency(m, s, name) !== null))) reasons.push("section-move-review");
        const manual = classification === "divergent" || reviewReasons.length > 0 || reasons.includes("section-move-review") || reasons.includes("multiple-sections-review");
        return {
          section, name, A, B, C, classification,
          current: B,
          disposition: manual ? "manual-review" : classification === "upstream-only" ? "candidate-upstream" : "keep-downstream",
          reviewReasons: reasons,
          specKinds: { A: specKind(A), B: specKind(B), C: specKind(C) },
          exactVersionDirection: { AtoB: hasBase ? direction(A, B) : "base-missing", AtoC: hasBase ? direction(A, C) : "base-missing", BtoC: direction(B, C) },
          compatibility: "not-assessed", security: "not-assessed",
        };
      });
    });
    const policyReviews = policies.flatMap(field => {
      const values = manifests.map(m => m ? own(m, field) ?? null : null);
      if (values.every(v => v === null)) return [];
      return [{ field, A: values[0], B: values[1], C: values[2], current: values[1], classification: classify(...values as [Json, Json, Json], hasBase), disposition: "manual-review", reason: `${field}-not-assessed` }];
    });
    return { path: file, presence: { A: !!a, B: !!b, C: !!c }, names: { A: names[0], B: names[1], C: names[2] }, reviewReasons, entries, policyReviews };
  });
  return {
    schemaVersion: 1,
    id: hash({ reportSchemaVersion: 1, inputHashes }), inputHashes,
    mode: hasBase ? "three-way" : "inventory-only",
    status: "advisory", compatibility: "not-assessed", security: "not-assessed", baselineAdvanced: false,
    identity: { assessment: "asserted-not-verified", A: identities[0], B: identities[1], C: identities[2] },
    limitations: ["caller-supplied-workspace-map-not-discovered", "identity-and-completeness-not-verified", "no-lockfile-or-resolution-analysis", "no-peer-or-policy-solver", "no-security-advisories", "no-migration-or-business-test-evidence", "no-apply-or-baseline-advancement"],
    workspaces,
  };
}
