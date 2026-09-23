import { defaultConfig } from "./config";
import { registerSecret } from "./errors";
import type { Config } from "./types";

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const hostname = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9.-]+$/.test(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());

// Only copy recognized, valid fields. A draft is never used by a normal command
// or written to disk until the operator completes and saves guided setup.
export function inspectConfig(text: string): { draft: Config; issues: string[] } {
  const draft = defaultConfig("");
  const issues: string[] = [];
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch {
    return { draft, issues: ["The file is not valid JSON. Its settings cannot be recovered reliably; setup can rebuild it. The original file stays untouched until you choose Save."] };
  }
  function credentials(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (/^(?:(?:github|gh|vercel)[_-]?)?(?:token|access[_-]?token|refresh[_-]?token|password|secret)$/i.test(key)) {
        if (typeof entry === "string") registerSecret(entry);
        issues.push(`Credential field ${key} is not allowed and will not be copied. Use provider CLI sessions or environment tokens.`);
      }
      credentials(entry);
    }
  }
  credentials(parsed);
  const raw = object(parsed);
  if (!raw) return { draft, issues: [...issues, "Configuration must be a JSON object; setup can rebuild it."] };
  if (typeof raw.repository === "string" && /^[\w.-]+\/[\w.-]+$/.test(raw.repository)) draft.repository = raw.repository;
  else issues.push("repository is missing or invalid; choose owner/repository.");
  if (nonempty(raw.workflowRef)) draft.workflowRef = raw.workflowRef;
  else issues.push("workflowRef is missing or invalid; setup will offer main as a default.");
  if (nonempty(raw.teamId)) draft.teamId = raw.teamId;
  else if (raw.teamId !== undefined) issues.push("teamId is invalid; select an accessible Vercel team.");
  const apps = object(raw.apps);
  if (!apps || !Object.keys(apps).length) {
    issues.push("apps is missing or invalid; setup will offer web, admin and landing.");
    return { draft, issues };
  }
  const recovered: Config["apps"] = {};
  let tracked = false;
  for (const [name, value] of Object.entries(apps)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) { issues.push("An app has an invalid name and cannot be retained."); continue; }
    const mappings = object(object(value)?.projects);
    const app: Config["apps"][string] = { projects: {} };
    recovered[name] = app;
    if (!mappings) issues.push(`${name}: projects is missing or invalid.`);
    for (const env of Object.keys(mappings ?? {})) if (!["staging", "production"].includes(env)) issues.push(`${name}: unsupported environment ${env} will not be copied.`);
    for (const env of ["staging", "production"] as const) {
      const source = mappings?.[env];
      if (source === null) { app.projects[env] = null; continue; }
      const project = object(source);
      if (!project || !nonempty(project.id)) { issues.push(`${name}/${env}: select a Vercel project or explicitly skip tracking.`); continue; }
      tracked = true;
      app.projects[env] = { id: project.id };
      if (project.domain === null || hostname(project.domain)) app.projects[env]!.domain = project.domain;
      else issues.push(`${name}/${env}: ${project.domain === undefined ? "no hostname chosen" : "invalid hostname"}; choose a hostname or explicitly track all domains.`);
    }
  }
  if (Object.keys(recovered).length) draft.apps = recovered;
  else issues.push("No valid app names were found; setup will offer web, admin and landing.");
  if (tracked && !draft.teamId) issues.push("teamId is missing; select the Vercel team that owns the configured projects.");
  return { draft, issues };
}
