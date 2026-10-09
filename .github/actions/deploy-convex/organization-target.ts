/** Executed from trusted workflow tooling, even when deploying a historical source checkout. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { withTarget, type ConvexCommand } from "./fixture-target.ts";
import { organizationFunctionRoot } from "./organization-source.ts";

export interface OrganizationSource { deploymentVersion: string; registryHash: string }

/** Bind actual backend source (including an app's migration code), not a caller-supplied label. */
export function backendSourceDigest(root: string): string {
  root = realpathSync(root);
  const base = root;
  const hash = createHash("sha256");
  const bound = new Set<string>();
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || ["node_modules", "_generated", "dist", "coverage", "qa", "tests", "test", "docs", "artifacts", "playwright-report", "test-results"].includes(entry.name)) continue;
      const file = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Organization deployment source must not contain symbolic links.");
      if (entry.isDirectory()) visit(file);
      else if (/\.(?:[cm]?[jt]sx?|json|wasm|lock)$/.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        bound.add(file);
      }
    }
  }
  // App-owned workspace packages and custom function-root/configuration files
  // may affect authorization just as platform code does. Bind them all, even
  // when they sit outside the starter's conventional backend directories.
  visit(root);
  // An imported module is executable even in a conventionally excluded test or
  // hidden directory. Follow the backend's workspace imports rather than trusting
  // filename conventions to decide whether those bytes can change authority.
  const ts: typeof import("typescript") = createRequire(import.meta.url)("typescript");
  const config = ts.findConfigFile(organizationFunctionRoot(root), ts.sys.fileExists);
  const options = config ? ts.parseJsonConfigFileContent(ts.readConfigFile(config, ts.sys.readFile).config,
    ts.sys, dirname(config)).options : {};
  const seen = new Set<string>();
  function dependencies(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) return;
    const source = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
    for (const imported of source.importedFiles) {
      const resolution = ts.resolveModuleName(imported.fileName, file,
        { ...options, moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true, allowJs: true }, ts.sys).resolvedModule;
      const direct = resolve(dirname(file), imported.fileName);
      const target = resolution?.resolvedFileName ?? (imported.fileName.startsWith(".") && existsSync(direct) ? direct : undefined);
      if (!target) {
        if (imported.fileName.startsWith(".")) throw new Error(`Cannot bind imported organization source: ${relative(root, file)} -> ${imported.fileName}`);
        continue; // Published dependency versions are bound by the lockfile.
      }
      const actual = realpathSync(target);
      const local = relative(root, actual);
      if (local.startsWith(`..${sep}`) || local === "..") throw new Error("Organization deployment imports source outside the checkout.");
      if (local.split(sep).includes("node_modules")) continue;
      if (lstatSync(target).isSymbolicLink()) throw new Error("Organization deployment source must not contain symbolic links.");
      bound.add(actual);
      dependencies(actual);
    }
  }
  for (const file of [...bound]) if (file.startsWith(resolve(root, "packages/backend") + sep)) dependencies(file);
  // Dependency/config changes can alter authorization even when function text is unchanged.
  for (const file of ["bun.lock", "app.config.ts", "packages/backend/package.json"]) {
    bound.add(resolve(root, file));
  }
  for (const file of [...bound].sort()) hash.update(relative(base, file)).update("\0").update(readFileSync(file)).update("\0");
  return hash.digest("hex");
}

export function inspectOrganizationSource(root: string): OrganizationSource {
  let marker: string;
  try { marker = readFileSync(resolve(organizationFunctionRoot(root), "platform/organizationReadiness.ts"), "utf8"); }
  catch { throw new Error("Unsafe organization rollback: target source has no organization cutover contract."); }
  if (!/ORGANIZATION_MIGRATION_CONTRACT_VERSION\s*=\s*1\b/.test(marker)) {
    throw new Error("Unsupported organization cutover contract; use a compatible forward-recovery source.");
  }
  const checked = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning",
    "platform/tooling/organization-migration-check.ts", "--root", root], {
    cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (checked.status !== 0 || checked.error) throw new Error("Organization source inventory is incomplete; run the organization migration check before deployment.");
  const result: unknown = JSON.parse(checked.stdout);
  if (!result || typeof result !== "object" || !("registryHash" in result)
    || typeof result.registryHash !== "string" || !/^[a-f0-9]{64}$/.test(result.registryHash)) throw new Error("Invalid organization registry evidence.");
  return { deploymentVersion: backendSourceDigest(root), registryHash: result.registryHash };
}

function json(command: ConvexCommand, name: string, args: object = {}): Record<string, unknown> {
  const value: unknown = JSON.parse(command(["run", name, JSON.stringify(args)]));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid organization deployment response.");
  return value as Record<string, unknown>;
}

export function prepareOrganizationDeployment(command: ConvexCommand, source: OrganizationSource) {
  const entries = command(["env", "list", "--names-only"]).split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  if (entries.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error("Cannot establish the organization deployment environment.");
  const names = new Set(entries);
  if (names.has("ORGANIZATION_CUTOVER_ENFORCED")) {
    const status = json(command, "organizationMigration:status");
    const deployment = status.deployment;
    if (typeof deployment !== "string" || !deployment) throw new Error("Cannot establish the organization deployment identity.");
    if (status.deploymentVersion !== source.deploymentVersion || status.registryHash !== source.registryHash) {
      command(["run", "organizationMigration:maintenance", JSON.stringify({ confirmDeployment: deployment,
        nextDeploymentVersion: source.deploymentVersion })]);
    }
  }
  // Changing binding closes current guarded writers immediately, including a resumed first deploy.
  command(["env", "set", "ORGANIZATION_DEPLOYMENT_VERSION", source.deploymentVersion]);
  command(["env", "set", "ORGANIZATION_REGISTRY_HASH", source.registryHash]);
}

/** Explicit operator recovery for a failed pending source; normal deployment
 * never silently substitutes a different target. This does not deploy or unlock. */
export function recoverOrganizationDeployment(command: ConvexCommand, source: OrganizationSource, expectedPendingDeploymentVersion: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedPendingDeploymentVersion) || expectedPendingDeploymentVersion === source.deploymentVersion) {
    throw new Error("An exact, different pending source digest is required for forward recovery.");
  }
  const status = json(command, "organizationMigration:status");
  if (typeof status.deployment !== "string" || !status.deployment) throw new Error("Cannot establish the organization deployment identity.");
  const receipt = status.receipt as { phase?: unknown; nextDeploymentVersion?: unknown } | undefined;
  // Recovery can commit before an environment update fails. Resume the already
  // recorded exact target through the ordinary maintenance CAS in that case.
  if (!(receipt?.phase === "maintenance" && receipt.nextDeploymentVersion === source.deploymentVersion)) {
    command(["run", "organizationMigration:recoverForward", JSON.stringify({ confirmDeployment: status.deployment,
      expectedPendingDeploymentVersion, nextDeploymentVersion: source.deploymentVersion })]);
  }
  prepareOrganizationDeployment(command, source);
}

export function verifyOrganizationDeployment(command: ConvexCommand, source: OrganizationSource) {
  const status = json(command, "organizationMigration:status");
  if (typeof status.deployment !== "string" || !status.deployment || status.expectedRegistryHash !== source.registryHash) {
    throw new Error("Deployed organization code does not match the verified source registry.");
  }
  command(["run", "organizationMigration:begin", JSON.stringify({ confirmDeployment: status.deployment, deploymentVersion: source.deploymentVersion })]);
  let complete = false;
  for (let batch = 0; batch < 20_000; batch++) {
    if (json(command, "organizationMigration:step", { batchSize: 100 }).complete === true) { complete = true; break; }
  }
  if (!complete) throw new Error("Organization migration batch limit reached; deployment remains in maintenance. Resume the same source.");
  const finalStatus = json(command, "organizationMigration:status");
  if (finalStatus.ready !== true) json(command, "organizationMigration:finalize");
  const verified = json(command, "organizationMigration:status");
  if (verified.ready !== true || verified.deploymentVersion !== source.deploymentVersion || verified.registryHash !== source.registryHash) {
    throw new Error("Organization migration did not establish readiness for this source.");
  }
  command(["env", "set", "ORGANIZATION_CUTOVER_ENFORCED", "1"]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const phase = process.argv[2];
    if (phase !== "prepare" && phase !== "verify" && phase !== "recover-forward") throw new Error("Use organization-target.ts prepare|verify [source-root], or recover-forward <source-root> <expected-pending-digest>.");
    const root = resolve(process.argv[3] ?? process.cwd());
    const source = inspectOrganizationSource(root);
    const target = process.env.CONVEX_DEPLOY_KEY ? { CONVEX_DEPLOY_KEY: process.env.CONVEX_DEPLOY_KEY }
      : { CONVEX_SELF_HOSTED_URL: process.env.CONVEX_SELF_HOSTED_URL, CONVEX_SELF_HOSTED_ADMIN_KEY: process.env.CONVEX_SELF_HOSTED_ADMIN_KEY };
    if (!target.CONVEX_DEPLOY_KEY && (!target.CONVEX_SELF_HOSTED_URL || !target.CONVEX_SELF_HOSTED_ADMIN_KEY)) throw new Error("Explicit target deployment credentials are required.");
    withTarget(root, target, command => phase === "prepare" ? prepareOrganizationDeployment(command, source)
      : phase === "verify" ? verifyOrganizationDeployment(command, source)
      : recoverOrganizationDeployment(command, source, process.argv[4] ?? ""));
    console.log(`Organization deployment ${phase} succeeded for source ${source.deploymentVersion}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Organization deployment check failed.");
    process.exitCode = 1;
  }
}
