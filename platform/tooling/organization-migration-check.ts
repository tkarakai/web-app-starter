/** Check the app-owned cutover inventory before binding a deployment receipt. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { organizationFunctionRoot } from "../../.github/actions/deploy-convex/organization-source.ts";
export { organizationFunctionRoot } from "../../.github/actions/deploy-convex/organization-source.ts";

type Registry = { version: number; tables: Record<string, string>; functions: Record<string, string>; jobs: Record<string, string>; components: Record<string, string> };
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}
export function registryHash(registry: Registry): string { return createHash("sha256").update(canonical(registry)).digest("hex"); }
const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;
function files(dir: string, includePlatform = false): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (["_generated", "node_modules"].includes(entry.name) || (!includePlatform && entry.name === "platform")) return [];
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`ORGANIZATION_SOURCE_SYMLINK_REVIEW_REQUIRED:${path}`);
    // Match Convex's entry-point extensions and multi-dot exclusion. Config is
    // inspected separately: component installation is an execution boundary too.
    return entry.isDirectory() ? files(path, includePlatform) : sourceExtension.test(entry.name)
      && !entry.name.startsWith(".") && !entry.name.startsWith("#") && !entry.name.includes(" ")
      && (!entry.name.replace(sourceExtension, "").includes(".") || entry.name === "convex.config.ts") ? [path] : [];
  });
}
export async function checkOrganizationMigration(root: string, backendPath?: string) {
  root = realpathSync(root);
  const backend = backendPath ? resolve(root, backendPath) : organizationFunctionRoot(root);
  const require = createRequire(resolve(root, "packages/backend/package.json"));
  const ts: typeof import("typescript") = require("typescript");
  const registration = resolve(backend, "organizationMigrationRegistry.ts");
  if (!existsSync(registration)) throw new Error("ORGANIZATION_REGISTRY_REQUIRED");
  const imported = await import(pathToFileURL(registration).href);
  const registry: Registry = imported.organizationMigrationRegistry;
  if (!registry || registry.version !== 1 || !registry.tables || !registry.functions || !registry.jobs || !registry.components) throw new Error("ORGANIZATION_REGISTRY_REQUIRED");
  const discovered = new Set<string>(); const jobs = new Set<string>(); const tables = new Set<string>(); const components = new Set<string>();
  const appFiles = new Set(files(backend));
  const configFile = ts.findConfigFile(backend, ts.sys.fileExists);
  const compilerOptions = configFile ? ts.parseJsonConfigFileContent(ts.readConfigFile(configFile, ts.sys.readFile).config,
    ts.sys, dirname(configFile)).options : {};
  const sources = new Set(files(backend, true));
  // Registration helpers can live in any app-owned workspace package. Inspect
  // their execution surfaces as well; an import must not hide a route or job.
  for (const path of sources) {
    for (const imported of ts.preProcessFile(readFileSync(path, "utf8"), true, true).importedFiles) {
      const resolved = ts.resolveModuleName(imported.fileName, path,
        { ...compilerOptions, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true }, ts.sys).resolvedModule?.resolvedFileName;
      const direct = resolve(dirname(path), imported.fileName);
      const target = resolved ?? (imported.fileName.startsWith(".") && existsSync(direct) ? direct : undefined);
      if (!target) continue;
      const actual = realpathSync(target);
      if (actual.split(sep).includes("node_modules") || !sourceExtension.test(actual)) continue;
      if (relative(root, actual).startsWith("..")) throw new Error("ORGANIZATION_EXTERNAL_SOURCE_REVIEW_REQUIRED");
      sources.add(actual);
    }
  }
  for (const path of sources) {
    const appOwned = appFiles.has(path) || !relative(root, path).split(sep).includes("platform");
    const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const module = relative(backend, path).replace(/\\/g, "/").replace(sourceExtension, "");
    for (const statement of appFiles.has(path) && !path.endsWith("convex.config.ts") ? ast.statements : []) {
      if (ts.isVariableStatement(statement) && statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!(module === "organizationMigrationRegistry" && declaration.name.getText(ast) === "organizationMigrationRegistry")) {
            if (!ts.isIdentifier(declaration.name)) throw new Error(`ORGANIZATION_EXPORT_REVIEW_REQUIRED:${module}`);
            discovered.add(`${module}:${declaration.name.text}`);
          }
        }
      }
      if (ts.isExportAssignment(statement) && module !== "schema") discovered.add(`${module}:default`);
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && (!statement.exportClause || !ts.isNamedExports(statement.exportClause))) {
        throw new Error(`ORGANIZATION_EXPORT_REVIEW_REQUIRED:${module}:replace-wildcards-with-explicit-names`);
      }
      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) if (!statement.isTypeOnly && !element.isTypeOnly) discovered.add(`${module}:${element.name.text}`);
      }
    }
    const visit = (node: import("typescript").Node) => {
      if (appFiles.has(path) && ts.isPropertyAssignment(node) && ts.isCallExpression(node.initializer)) {
        let call = node.initializer;
        while (ts.isPropertyAccessExpression(call.expression) && ts.isCallExpression(call.expression.expression)) call = call.expression.expression;
        if (call.expression.getText(ast) === "defineTable") tables.add(node.name.getText(ast).replace(/^['"]|['"]$/g, ""));
      }
      if (appOwned && ts.isIdentifier(node) && node.text === "exports") throw new Error(`ORGANIZATION_COMMONJS_REVIEW_REQUIRED:${module}`);
      if (ts.isPropertyAccessExpression(node) && node.name.text === "scheduler"
        && !(ts.isPropertyAccessExpression(node.parent) && ["runAfter", "runAt", "cancel"].includes(node.parent.name.text)
          || ts.isElementAccessExpression(node.parent) && ts.isStringLiteral(node.parent.argumentExpression)
            && ["runAfter", "runAt", "cancel"].includes(node.parent.argumentExpression.text))) throw new Error(`ORGANIZATION_SCHEDULER_ESCAPE_REVIEW_REQUIRED:${module}`);
      if (appOwned && ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression)
        && !ts.isStringLiteral(node.expression.argumentExpression)) throw new Error(`ORGANIZATION_DYNAMIC_EXECUTION_REVIEW_REQUIRED:${module}`);
      if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
        && ["scheduler", "runAfter", "runAt", ...(appOwned ? ["route", "interval", "cron", "use"] : [])].includes(node.argumentExpression.text)
        && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) throw new Error(`ORGANIZATION_EXECUTION_ALIAS_REVIEW_REQUIRED:${module}`);
      if (ts.isBindingElement(node) && ["runAfter", "runAt", "route", "interval", "cron", "use"].includes((node.propertyName ?? node.name).getText(ast))) {
        throw new Error(`ORGANIZATION_EXECUTION_ALIAS_REVIEW_REQUIRED:${module}`);
      }
      const method = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
        : ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression) && ts.isStringLiteral(node.expression.argumentExpression) ? node.expression.argumentExpression.text : null;
      if (ts.isPropertyAccessExpression(node) && (appOwned ? ["runAfter", "runAt", "route", "use"] : ["runAfter", "runAt"]).includes(node.name.text)
        && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) throw new Error(`ORGANIZATION_EXECUTION_ALIAS_REVIEW_REQUIRED:${module}`);
      if (appOwned && ts.isCallExpression(node) && method) {
        if (method === "route") {
          const route = node.arguments[0];
          if (!route || !ts.isObjectLiteralExpression(route)) throw new Error(`ORGANIZATION_HTTP_REVIEW_REQUIRED:${module}`);
          const literals = Object.fromEntries(route.properties.flatMap(property => ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)
            ? [[property.name.getText(ast).replace(/^['"]|['"]$/g, ""), property.initializer.text]] : []));
          if (!literals.method || !(literals.path || literals.pathPrefix)) throw new Error(`ORGANIZATION_HTTP_REVIEW_REQUIRED:${module}`);
          discovered.add(`${module}:${literals.method} ${literals.path ?? `${literals.pathPrefix}*`}`);
        }
        if (["interval", "cron", "hourly", "daily", "weekly", "monthly"].includes(method)) {
          const reference = node.arguments[2]?.getText(ast);
          const match = reference?.match(/^internal\.(.+)\.([A-Za-z_$][\w$]*)$/);
          if (!match) throw new Error(`ORGANIZATION_DYNAMIC_JOB_REVIEW_REQUIRED:${module}`);
          jobs.add(`${match[1].replace(/\./g, "/")}:${match[2]}`);
        }
        if (method === "use") {
          const component = node.arguments[0];
          if (!component || !ts.isIdentifier(component)) throw new Error(`ORGANIZATION_COMPONENT_REVIEW_REQUIRED:${module}`);
          let name = component.text;
          const options = node.arguments[1];
          if (options) {
            if (!ts.isObjectLiteralExpression(options)) throw new Error(`ORGANIZATION_COMPONENT_REVIEW_REQUIRED:${module}`);
            const configured = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(ast) === "name");
            if (configured && ts.isPropertyAssignment(configured)) {
              if (!ts.isStringLiteral(configured.initializer)) throw new Error(`ORGANIZATION_COMPONENT_REVIEW_REQUIRED:${module}`);
              name = configured.initializer.text;
            }
          }
          components.add(name);
        }
      }
      if (ts.isCallExpression(node) && (method === "runAfter" || method === "runAt")) {
        const reference = node.arguments[1]?.getText(ast);
        const match = reference?.match(/^internal\.(.+)\.([A-Za-z_$][\w$]*)$/);
        if (!match) throw new Error(`ORGANIZATION_DYNAMIC_JOB_REVIEW_REQUIRED:${module}`);
        jobs.add(`${match[1].replace(/\./g, "/")}:${match[2]}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  const missingFunctions = [...discovered].filter(name => !registry.functions[name]);
  const staleFunctions = Object.keys(registry.functions).filter(name => !discovered.has(name));
  const missingTables = [...tables].filter(name => !registry.tables[name]);
  const missingJobs = [...jobs].filter(name => !registry.jobs[name]);
  const missingComponents = [...components].filter(name => !registry.components[name]?.trim());
  if (missingFunctions.length || staleFunctions.length || missingTables.length || missingJobs.length || missingComponents.length) throw new Error(`ORGANIZATION_INVENTORY_INCOMPLETE:${JSON.stringify({ missingFunctions, staleFunctions, missingTables, missingJobs, missingComponents })}`);
  const allowed = new Set(["tenant", "legacy-retired", "identity-private", "platform-control", "migration-internal"]);
  if (Object.values(registry.functions).some(value => !allowed.has(value))) throw new Error("ORGANIZATION_FUNCTION_DISPOSITION_UNRESOLVED");
  if (Object.values(registry.jobs).some(value => !["cancel", "drain", "preserve-control", "epoch-control"].includes(value))) throw new Error("ORGANIZATION_JOB_DISPOSITION_UNRESOLVED");
  if (Object.values(registry.tables).some(value => !["private-root", "private-child", "identity-private", "platform-control", "authority-retire", "artifact-quarantine", "migration-bookkeeping"].includes(value))) throw new Error("ORGANIZATION_TABLE_DISPOSITION_UNRESOLVED");
  return { registryHash: registryHash(registry), registryVersion: registry.version, tables: [...tables].sort(), functions: [...discovered].sort(), jobs: [...jobs].sort(), components: [...components].sort() };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.indexOf("--root");
  try { process.stdout.write(`${JSON.stringify(await checkOrganizationMigration(rootArg < 0 ? process.cwd() : resolve(process.argv[rootArg + 1])), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
