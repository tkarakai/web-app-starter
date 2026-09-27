import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { BOUNDARY, PACKAGE, requireThat, sourceFiles } from "./model.ts";

/** Resolve the consumer's actual TS import graph rather than trusting directory labels. */
export function validateConsumerImports(app: string, repository: string): void {
  const config = ts.readConfigFile(path.join(app, "tsconfig.json"), ts.sys.readFile);
  requireThat(!config.error, "Cannot read consumer TypeScript configuration");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, app);
  const consumed = fs.realpathSync(path.join(app, BOUNDARY));
  const dependency = fs.realpathSync(path.join(app, "node_modules", PACKAGE));
  for (const file of Object.keys(sourceFiles(app)).filter(f => /\.[cm]?tsx?$/.test(f) && (f.startsWith("src/") || f.startsWith("qa/tests/")))) {
    const source = path.join(app, file);
    for (const imported of ts.preProcessFile(fs.readFileSync(source, "utf8"), true, true).importedFiles) {
      const specifier = imported.fileName;
      if (specifier.startsWith("@repo/") || specifier.startsWith(path.dirname(PACKAGE) + "/")) requireThat(specifier === PACKAGE, "Consumer may only use the approved starter package export");
      const resolved = ts.resolveModuleName(specifier, source, parsed.options, ts.sys).resolvedModule;
      if (!resolved) { requireThat(specifier !== PACKAGE, "Cannot resolve consumed package types"); continue; }
      const target = fs.realpathSync(resolved.resolvedFileName);
      const inPackage = target.startsWith(consumed + path.sep) || target.startsWith(dependency + path.sep);
      requireThat(!inPackage || specifier === PACKAGE, "Consumer must import the package API, not private artifact files");
      const inWorkspace = ["packages", "apps", "platform"].some(dir => target.startsWith(path.join(repository, dir) + path.sep));
      requireThat(!inWorkspace || target.startsWith(app + path.sep), "Consumer must not import other workspace source");
      if (specifier === PACKAGE) requireThat(inPackage, "Consumer type alias bypasses the installed starter package");
    }
  }
}
