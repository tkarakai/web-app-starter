#!/usr/bin/env node
/** Checks only the supported package boundary; legacy mixed areas are not certified. */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import * as u from "./upgrade.ts";

export function authorBoundary(root: string, output: string): void {
  const author = path.join(root, "packages/starter-sidebar-policy");
  const config = ts.readConfigFile(path.join(author, "tsconfig.json"), ts.sys.readFile);
  u.requireThat(!config.error, "Invalid author package TypeScript configuration");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, author);
  u.requireThat(parsed.options.noResolve && parsed.options.noUncheckedSideEffectImports && u.equal(parsed.options.types, []), "Consumed package must compile without external types or imports");
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, outDir: output });
  for (const source of program.getSourceFiles().filter(s => !s.isDeclarationFile)) {
    u.requireThat(source.fileName === path.join(author, "src/index.ts"), "Unexpected consumed package source");
    const dependencies = ts.preProcessFile(source.text, true, true);
    u.requireThat(dependencies.importedFiles.length === 0 && dependencies.referencedFiles.length === 0 && dependencies.typeReferenceDirectives.length === 0, "Consumed policy cannot depend on application or editable UI code");
  }
  const diagnostics = ts.getPreEmitDiagnostics(program);
  u.requireThat(!diagnostics.length, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => "\n" }));
  u.requireThat(!program.emit().emitSkipped, "Package build failed");
}
export function checkOwnership(root = u.ROOT): object {
  const app = path.join(root, "apps/demo"), releases = path.join(app, "qa/fixtures/starter-releases");
  const catalog = u.catalogue(releases), value = u.manifest(app);
  u.sourceFiles(app); u.baseline(app, catalog); u.consumerBoundary(app);
  const representatives = { "src/components/ui/sidebar.tsx": "application", "src/business/dispatch.ts": "application", "public/northstar.svg": "application", [u.PAYLOADS[1]]: "consumed", [u.LOCK]: "generated", ".next/server/app/dashboard.html": "generated" };
  for (const [file, owner] of Object.entries(representatives)) u.requireThat(u.ownerOf(value, file) === owner, `Incorrect demo ownership: ${file}`);
  const inventory = u.readJson<{ schemaVersion: number; consumedPackage: string; legacyMixed: string[]; vendoring: string; fixtureDigests: Record<string, string> }>(path.join(root, "scripts/starter-upgrade/ownership.json"));
  u.requireThat(inventory.consumedPackage === u.PACKAGE && inventory.vendoring === "unsupported", "Unexpected ownership scope");
  for (const legacy of inventory.legacyMixed) u.requireThat(fs.statSync(path.join(root, legacy)).isDirectory() && legacy !== "packages/starter-sidebar-policy", "Invalid legacy ownership inventory");
  for (const [version, release] of Object.entries(catalog.releases)) u.requireThat(inventory.fixtureDigests[version] === u.fingerprint(release), `Immutable fixture metadata changed: ${version}; add a new release instead`);
  u.requireThat(u.equal(Object.keys(inventory.fixtureDigests).sort(), Object.keys(catalog.releases).sort()), "Fixture inventory is incomplete");
  const parent = path.join(root, ".ci-local-artifacts"); fs.mkdirSync(parent, { recursive: true });
  const output = fs.mkdtempSync(path.join(parent, "starter-package-build-"));
  try {
    authorBoundary(root, output);
    const author = JSON.parse(fs.readFileSync(path.join(root, "packages/starter-sidebar-policy/package.json"), "utf8")) as { name: string; version: string; exports: unknown; files: unknown; dependencies?: unknown; peerDependencies?: unknown };
    u.requireThat(author.name === u.PACKAGE && author.version === catalog.latest && !author.dependencies && !author.peerDependencies, "Author package must be independently versioned without application dependencies");
    const releaseRoot = path.join(releases, catalog.latest, u.BOUNDARY);
    const artifact = JSON.parse(fs.readFileSync(path.join(releaseRoot, "package.json"), "utf8")) as { exports: unknown; files: unknown };
    u.requireThat(u.equal(author.exports, artifact.exports) && u.equal(author.files, artifact.files), "Author and release exports differ");
    for (const file of ["index.js", "index.d.ts"]) u.requireThat(fs.readFileSync(path.join(output, file)).equals(fs.readFileSync(path.join(releaseRoot, "dist", file))), `Author package does not build the current immutable release: ${file}`);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
  // Execute the package export map through Node, including a refused private subpath.
  execFileSync(process.execPath, ["--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    const policy = await import('${u.PACKAGE}');
    assert.deepEqual(Object.keys(policy).sort(), ['SIDEBAR_WIDTH_DEFAULT_REM','clampSidebarWidth','snapSidebarWidth'].sort());
    assert.equal(policy.clampSidebarWidth(NaN),16);
    await assert.rejects(import('${u.PACKAGE}/dist/index.js'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  `], { cwd: app, stdio: "pipe" });
  return { schemaVersion: 1, status: "verified", consumedPackage: u.PACKAGE, legacyMixed: inventory.legacyMixed, vendoring: "unsupported", representatives };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.stdout.write(u.encode(checkOwnership()));
