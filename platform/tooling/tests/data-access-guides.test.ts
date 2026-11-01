import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(path.join(root, "packages/backend/package.json"));

test("the four documented data models compile and enforce their audiences through real auth/org builders", { timeout: 120_000 }, t => {
  const fixture = mkdtempSync(path.join(tmpdir(), "starter-data-access-guides-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  // Copy the app backend, not its dependencies or environment. Platform packages are the
  // exact installed checkout inputs; only app-owned schema/modules change in this fixture.
  const backend = path.join(fixture, "packages/backend");
  mkdirSync(path.dirname(backend), { recursive: true });
  cpSync(path.join(root, "packages/backend"), backend, {
    recursive: true,
    filter: file => !file.split(path.sep).some(part => part === "node_modules" || part === ".turbo")
      && !path.basename(file).startsWith(".env"),
  });
  symlinkSync(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
  symlinkSync(path.join(root, "packages/backend/node_modules"), path.join(backend, "node_modules"), "dir");
  symlinkSync(path.join(root, "platform"), path.join(fixture, "platform"), "dir");
  cpSync(path.join(root, "package.json"), path.join(fixture, "package.json"));

  const schemas: string[] = [];
  const files = new Map<string, string>();
  for (const name of ["individual-accounts", "shared-workspace", "organization-private", "private-and-shared"]) {
    const guide = readFileSync(path.join(root, "platform/docs/data-access", `${name}.md`), "utf8");
    for (const match of guide.matchAll(/<!-- data-access-schema -->\s*```ts\n([\s\S]*?)```/g)) schemas.push(match[1]);
    for (const match of guide.matchAll(/<!-- data-access-file: ([A-Za-z]+\.ts) -->\s*```ts\n([\s\S]*?)```/g)) {
      assert(!files.has(match[1]), `Duplicate guide module: ${match[1]}`);
      files.set(match[1], match[2]);
    }
  }
  assert.equal(schemas.length, 3, "Extract all documented schemas");
  assert.deepEqual([...files.keys()].sort(), ["notePublishing.ts", "organizationData.ts", "personalNotes.ts", "privateNotes.ts", "teamNotes.ts"]);
  const convex = path.join(backend, "convex");
  // Keep this check runnable in adopted apps that already use the guide's table/module
  // names. Rename those identifiers consistently; authorization logic is copied verbatim.
  const namespace = `guide_${path.basename(fixture).split("-").at(-1)}_`;
  const isolate = (source: string): string => source.replace(
    /\b(personalNotes|privateNotes|teamNotes|notePublishing|organizationData)\b/g,
    name => namespace + name,
  );
  const schemaFile = path.join(convex, "schema.ts");
  const original = readFileSync(schemaFile, "utf8");
  const end = original.lastIndexOf("});");
  assert(end > 0, "Find the app schema seam");
  // Merge the new imports into the seam without duplicating imports an app already has.
  const imports = original
    .replace(/import \{\s*defineSchema\s*\} from "convex\/server";/, 'import { defineSchema, defineTable } from "convex/server";');
  assert(imports.includes("defineTable"), "The app schema must import defineTable or use the standard defineSchema import");
  const withValues = /import \{[^}]*\bv\b[^}]*\} from "convex\/values";/.test(imports)
    ? imports : `import { v } from "convex/values";\n${imports}`;
  const insertion = withValues.lastIndexOf("});");
  writeFileSync(schemaFile, `${withValues.slice(0, insertion)}${isolate(schemas.join("\n"))}\n${withValues.slice(insertion)}`);
  for (const [name, source] of files) writeFileSync(path.join(convex, isolate(name)), isolate(source));
  writeFileSync(path.join(convex, "data-access-guides.contract.test.ts"), isolate(readFileSync(path.join(root, "platform/tooling/tests/fixtures/data-access/contract.test.ts.txt"), "utf8")));

  const options = { cwd: backend, encoding: "utf8" as const, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 };
  try {
    // The generated data-model types derive from schema.ts; no generated file is edited.
    execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "convex"], options);
    const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
    const output = execFileSync(process.execPath, [vitest, "run", "--config", "vitest.config.ts", "convex/data-access-guides.contract.test.ts"], options);
    t.diagnostic(output);
  } catch (error) {
    const failed = error as { message?: string; stdout?: string; stderr?: string };
    assert.fail(`Documented examples failed: ${failed.message?.split("\n")[0] ?? String(error)}\n${failed.stdout ?? ""}\n${failed.stderr ?? ""}`);
  }
});
