#!/usr/bin/env node
/**
 * Credential ceremonies must not publish raw Playwright actions, errors or captures.
 * Migrate package commands and a literal defineConfig object without replacing app settings.
 * Run from the repository root: node-ts.sh platform/tooling/codemods/v2-secret-safe-e2e.ts
 * [--check] [--app PATH] [ROOT]. Custom commands/config factories require explicit review.
 */
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function inside(root: string, file: string) {
  if (!file.startsWith(root + sep)) throw new Error("Target must be inside the repository");
  for (let current = file; current !== dirname(root); current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Refusing a symlinked migration target");
    if (current === root) break;
  }
}
const portable = (value: string) => value.replaceAll("\\", "/");
const modulePath = (from: string, to: string) => {
  const value = portable(relative(from, to)); return value.startsWith(".") ? value : `./${value}`;
};

export function transformConfig(text: string, reporter: string): string {
  const source = ts.createSourceFile("playwright.config.ts", text, ts.ScriptTarget.Latest, true);
  const assignment = source.statements.find(ts.isExportAssignment);
  const call = assignment?.expression;
  if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "defineConfig" ||
      call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) {
    throw new Error("Custom Playwright config: migrate its reporter and capture settings explicitly");
  }
  const edits: { start: number; end: number; value: string }[] = [];
  function set(object: ts.ObjectLiteralExpression, key: string, value: string) {
    if (object.properties.some(property => property.name && ts.isComputedPropertyName(property.name))) {
      throw new Error("Computed config properties: migrate explicitly");
    }
    const properties = object.properties.filter(property => property.name &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === key);
    if (properties.length > 1) throw new Error(`Duplicate config property: ${key}`);
    if (properties.length) {
      const property = properties[0];
      if (!ts.isPropertyAssignment(property)) throw new Error(`Custom config property: ${key}`);
      if (object.properties.slice(object.properties.indexOf(property) + 1).some(ts.isSpreadAssignment)) {
        throw new Error(`A later config spread can override ${key}; migrate explicitly`);
      }
      edits.push({ start: property.initializer.getStart(source), end: property.initializer.end, value });
    } else {
      // Insert at the end so a preceding spread cannot re-enable raw captures.
      const last = object.properties.at(-1);
      const needsComma = last && !object.properties.hasTrailingComma;
      edits.push({ start: object.end - 1, end: object.end - 1, value: `${needsComma ? "," : ""}\n${key}: ${value},\n` });
    }
  }
  const config = call.arguments[0];
  if (config.properties.some(ts.isSpreadAssignment)) throw new Error("Custom config spread: migrate explicitly");
  set(config, "reporter", `[[${JSON.stringify(reporter)}]]`);
  const uses: ts.ObjectLiteralExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === "projects") {
      if (!ts.isArrayLiteralExpression(node.initializer) || node.initializer.elements.some(project =>
        !ts.isObjectLiteralExpression(project) || project.properties.some(property =>
          ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name))))) {
        throw new Error("Custom project configuration: migrate captures explicitly");
      }
    }
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === "use") {
      if (!ts.isObjectLiteralExpression(node.initializer)) throw new Error("Custom use expression: disable captures explicitly");
      uses.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(config);
  if (!uses.length) set(config, "use", '{ trace: "off", screenshot: "off", video: "off" }');
  for (const use of uses) for (const key of ["trace", "screenshot", "video"]) set(use, key, '"off"');
  let result = text;
  // Combine insertions at one position to avoid duplicate separators.
  const grouped = new Map<number, typeof edits>();
  for (const edit of edits) grouped.set(edit.start, [...(grouped.get(edit.start) ?? []), edit]);
  for (const [start, group] of [...grouped].sort(([a], [b]) => b - a)) {
    const value = group.map((edit, index) => index ? edit.value.replace(/^,/, "") : edit.value).join("");
    result = result.slice(0, start) + value + result.slice(group[0].end);
  }
  // Our own marker is an executable import/call, not a comment-sensitive search.
  const guarded = source.statements.some(statement => ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) && ts.isIdentifier(statement.expression.expression) &&
    ["assertSecretSafeRunner", "enforceSecretSafeE2e"].includes(statement.expression.expression.text));
  const configGuard = reporter.replace(/secret-safe-reporter\.ts$/, "secret-safe-config.ts");
  if (!guarded) result = `import { assertSecretSafeRunner as enforceSecretSafeE2e } from ${JSON.stringify(configGuard)};\nenforceSecretSafeE2e();\n` + result;
  if (!text.includes('process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1"')) result = 'process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";\n' + result;
  return result;
}

export function migrate(root: string, check = false, app = "apps/web") {
  const base = resolve(root); const directory = resolve(base, app);
  const manifest = resolve(directory, "package.json"); const config = resolve(directory, "playwright.config.ts");
  inside(base, manifest); inside(base, config);
  if (!existsSync(directory)) return [];
  if (!existsSync(manifest) || !existsSync(config)) throw new Error("App needs package.json and playwright.config.ts");
  const original = readFileSync(manifest, "utf8");
  const value = JSON.parse(original) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
  const runner = `${modulePath(directory, resolve(base, "platform/tooling/node-ts.sh"))} ${modulePath(directory, resolve(base, "platform/tooling/e2e/secret-safe-playwright.ts"))}`;
  for (const [name, previous, replacement] of [["test:e2e", "playwright test", runner], ["test:e2e:ui", "playwright test --ui", `${runner} --ui`]]) {
    const current = value.scripts?.[name];
    if (current && current !== previous && current !== replacement) throw new Error(`Custom ${name}: migrate its arguments explicitly`);
    if (current) value.scripts![name] = replacement;
  }
  const next = transformConfig(readFileSync(config, "utf8"), modulePath(directory, resolve(base, "platform/tooling/e2e/secret-safe-reporter.ts")));
  const changes = [[manifest, JSON.stringify(value, null, 2) + "\n"], [config, next]];
  const rootManifest = resolve(base, "package.json"); inside(base, rootManifest);
  const rootValue = JSON.parse(readFileSync(rootManifest, "utf8")) as { devDependencies?: Record<string, string> };
  if (!rootValue.devDependencies?.["@playwright/test"]) {
    const version = value.devDependencies?.["@playwright/test"];
    if (!version) throw new Error("Declare the app's supported @playwright/test version before migrating shared tooling");
    rootValue.devDependencies = { ...rootValue.devDependencies, "@playwright/test": version };
    changes.push([rootManifest, JSON.stringify(rootValue, null, 2) + "\n"]);
  }
  const changed = changes.filter(([file, content]) => readFileSync(file, "utf8") !== content);
  for (const [file, content] of changed) if (!check) writeFileSync(file, content);
  return changed.map(([file]) => portable(relative(base, file)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); const check = args.includes("--check"); const i = args.indexOf("--app");
    if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith("--"))) throw new Error("--app requires a path");
    const rest = args.filter((arg, index) => arg !== "--check" && index !== i && (i < 0 || index !== i + 1));
    if (rest.length > 1 || rest.some(arg => arg.startsWith("--"))) throw new Error("Usage: v2-secret-safe-e2e.ts [--check] [--app PATH] [ROOT]");
    const changed = migrate(rest[0] ?? ".", check, i < 0 ? undefined : args[i + 1]);
    for (const file of changed) process.stdout.write(`${check ? "Would update" : "Updated"} ${file}\n`);
    process.stdout.write(`${changed.length} file(s) ${check ? "need migration" : "updated"}\n`);
    if (check && changed.length) process.exitCode = 1;
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Migration failed"}\n`); process.exitCode = 1; }
}
