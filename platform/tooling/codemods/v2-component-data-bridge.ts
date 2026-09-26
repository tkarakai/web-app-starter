#!/usr/bin/env node
/**
 * v2 moves seven platform tables into a Convex component. Existing deployments
 * need this additive bridge BEFORE deploying v2's wrappers/schema. Prepare a
 * disposable checkout of the currently deployed source; legacy functions and
 * schema stay intact. This tool never deploys or migrates data.
 *
 * Run from that checkout: node /path/to/v2/platform/tooling/codemods/v2-component-data-bridge.ts
 * [--check] [--source V2_ROOT] [--convex-dir packages/backend/convex] [ROOT]
 * Requires the source release's dependencies installed (TypeScript AST parser).
 * Idempotent; --check writes nothing and exits 1 when changes are needed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const DEFAULT_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PACKAGE = "@web-app-starter/convex-platform";
const PACKAGE_DIR = "platform/packages/convex-platform";
const SKIP = new Set(["node_modules", ".turbo", ".convex", "coverage", "dist"]);

export function addComponent(text: string): string {
  const ast = ts.createSourceFile("convex.config.ts", text, ts.ScriptTarget.Latest, true);
  const appExport = ast.statements.find(ts.isExportAssignment);
  if (!appExport || !ts.isIdentifier(appExport.expression)) throw new Error("Expected a named default-exported Convex app; add the component manually and rerun.");
  const app = appExport.expression.text;
  const existing = ast.statements.filter(ts.isImportDeclaration).find(node => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === PACKAGE + "/convex.config");
  const binding = existing?.importClause?.name?.text ?? "platformMigrationComponent";
  let used = false;
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (ts.isPropertyAccessExpression(call.expression) && call.expression.expression.getText(ast) === app && call.expression.name.text === "use" && call.arguments[0]?.getText(ast) === binding) used = true;
  }
  if (existing && used) return text;
  if (!existing && new RegExp(`\\b${binding}\\b`).test(text)) throw new Error("Bridge component binding already exists; resolve it manually.");
  const install = used ? "" : `${app}.use(${binding});\n\n`;
  const inserted = text.slice(0, appExport.getStart(ast)) + install + text.slice(appExport.getStart(ast));
  return existing ? inserted : `import ${binding} from "${PACKAGE}/convex.config";\n` + inserted;
}

/** Compute all changes before writing any file, including collision/symlink checks. */
export function prepare(root: string, source = DEFAULT_SOURCE, check = false, convexDir = "packages/backend/convex"): string[] {
  root = fs.realpathSync(root); source = fs.realpathSync(source);
  if (path.isAbsolute(convexDir) || convexDir.split(/[\\/]/).includes("..")) throw new Error("convex-dir must stay inside ROOT");
  const writes = new Map<string, string>();
  const safePath = (relative: string): string => {
    let current = root;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Refusing symlink: " + relative);
    }
    return current;
  };
  const propose = (relative: string, after: string, replace = false): void => {
    const target = safePath(relative);
    if (fs.existsSync(target)) {
      const before = fs.readFileSync(target, "utf8");
      if (before === after) return;
      if (!replace) throw new Error("Bridge would overwrite an existing file: " + relative);
    }
    writes.set(relative, after);
  };
  const rootPkg = JSON.parse(fs.readFileSync(safePath("package.json"), "utf8"));
  if (!Array.isArray(rootPkg.workspaces)) throw new Error("Expected package.json workspaces array");
  if (!rootPkg.workspaces.includes("platform/packages/*")) rootPkg.workspaces.push("platform/packages/*");
  const backendPkgPath = path.join(path.dirname(convexDir), "package.json");
  const backendPkg = JSON.parse(fs.readFileSync(safePath(backendPkgPath), "utf8"));
  const sourceBackend = JSON.parse(fs.readFileSync(path.join(source, "packages/backend/package.json"), "utf8"));
  if (backendPkg.dependencies?.convex !== sourceBackend.dependencies.convex) throw new Error("Align the legacy backend's Convex dependency with this release before preparing the bridge; review that dependency upgrade separately.");
  backendPkg.dependencies[PACKAGE] = "workspace:*";
  propose("package.json", JSON.stringify(rootPkg, null, 2) + "\n", true);
  propose(backendPkgPath, JSON.stringify(backendPkg, null, 2) + "\n", true);
  const config = path.join(convexDir, "convex.config.ts");
  propose(config, addComponent(fs.readFileSync(safePath(config), "utf8")), true);
  const copyTree = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(source, relative), { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
      if (entry.isSymbolicLink()) throw new Error("Unexpected source symlink: " + entry.name);
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) copyTree(file);
      else if (entry.isFile()) propose(file, fs.readFileSync(path.join(source, file), "utf8"));
    }
  };
  copyTree(PACKAGE_DIR);
  const baseConfig = "platform/config/tsconfig.base.json";
  propose(baseConfig, fs.readFileSync(path.join(source, baseConfig), "utf8"));
  for (const file of ["componentMigration.ts", "componentMigrationLegacy.ts"]) {
    propose(path.join(convexDir, "platform", file), fs.readFileSync(path.join(source, "packages/backend/convex/platform", file), "utf8"));
  }
  for (const [relative, after] of writes) {
    if (!check) { const target = safePath(relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, after); }
  }
  return [...writes.keys()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    let check = false; let root = process.cwd(); let source = DEFAULT_SOURCE; let convexDir = "packages/backend/convex";
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--check") check = true;
      else if (arg === "--source" || arg === "--convex-dir") {
        const value = args[++i]; if (!value) throw new Error("Missing value for " + arg);
        if (arg === "--source") source = path.resolve(value); else convexDir = value;
      } else if (arg.startsWith("--")) throw new Error("Unknown option: " + arg);
      else root = path.resolve(arg);
    }
    const changed = prepare(root, source, check, convexDir);
    for (const file of changed) console.log(`${check ? "Would write" : "Wrote"} ${file}`);
    console.log(`${changed.length} file(s). Next: bun install, Convex codegen, review the bridge diff, then follow platform/docs/component-data-migration.md from the v2 source. No deployment or data changes were made.`);
    if (check && changed.length) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
