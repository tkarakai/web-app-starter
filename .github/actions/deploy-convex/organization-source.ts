/** Shared source layout resolution; kept with the trusted sparse-checkout action. */
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

export function organizationFunctionRoot(root: string): string {
  const configFile = resolve(root, "packages/backend/convex.json");
  const config: unknown = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("ORGANIZATION_FUNCTION_ROOT_INVALID");
  const functions = "functions" in config ? config.functions : "convex/";
  if (typeof functions !== "string" || !functions.trim()) throw new Error("ORGANIZATION_FUNCTION_ROOT_INVALID");
  const backend = resolve(root, "packages/backend", functions);
  const local = relative(resolve(root), backend);
  if (local === ".." || local.startsWith(`..${sep}`)) throw new Error("ORGANIZATION_FUNCTION_ROOT_OUTSIDE_SOURCE");
  return backend;
}
