/** Stable, dependency-free bootstrap. Run the pinned target tool, never the installed implementation. */
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { argumentsFor, HELP } from "./platform-upgrade/cli.ts";
import { createCache, fileAt, gitText, loadRelease, resolveSource } from "./platform-upgrade/git.ts";
import { ENTRY, demand } from "./platform-upgrade/metadata.ts";
import { readReport, reportAppRoot } from "./platform-upgrade/report.ts";
import { childEnvironment, redact } from "./platform-upgrade/commands.ts";

export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help")) { process.stdout.write(HELP); return 0; }
  const args = argumentsFor(argv);
  demand(!args.bootstrapProtocol && !args.targetCommit && !args.appRoot, "Bootstrap options are internal; recursive delegation refused");
  const root = fs.realpathSync(gitText(process.cwd(), ["rev-parse", "--show-toplevel"]));
  const saved = args.resume ? readReport(args.resume) : undefined;
  if (saved) demand(args.relocate || reportAppRoot(saved) === root, "Resume from the original checkout or use --relocate for a cloned draft");
  const source = saved?.plan.source ?? resolveSource(args.source), to = saved?.plan.target.version ?? args.to!;
  process.stdout.write("Trusted platform source: " + (source.kind === "github" ? source.repo : source.path) + "\n");
  const cache = createCache(source);
  try {
    const target = await loadRelease(cache, to);
    if (saved) demand(target.commit === saved.plan.target.commit && target.manifestDigest === saved.plan.target.manifestDigest, "Saved target changed; refusing to execute it");
    const protocol = JSON.parse(fileAt(cache.repo, target.tree, "platform/tooling/platform-upgrade/protocol.json").toString("utf8"));
    demand(protocol.schemaVersion === 1 && Object.keys(protocol).length === 1, "Unsupported target launcher protocol");
    const node = process.env.PLATFORM_UPGRADE_NODE ?? process.execPath;
    const runtime = spawnSync(node, ["--version"], { encoding: "utf8" });
    demand(runtime.status === 0 && runtime.stdout.trim().startsWith("v" + target.manifest.runtime.nodeMajor + "."), "Select Node " + target.manifest.runtime.nodeMajor + " (or set PLATFORM_UPGRADE_NODE to its executable)");
    const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
    demand(bun.status === 0 && bun.stdout.trim() === target.manifest.runtime.bun, "Select Bun " + target.manifest.runtime.bun + " before upgrading");
    const result = spawnSync(node, [target.directory + "/" + ENTRY, ...argv, "--bootstrap-protocol", "1", "--app-root", root, "--target-commit", target.commit], { cwd: process.cwd(), env: childEnvironment(), stdio: "inherit" });
    demand(!result.error, result.error?.message ?? "Target tool could not start"); return result.status ?? 1;
  } finally { fs.rmSync(cache.directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { process.stderr.write("platform-upgrade: " + redact(error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1; });
}
