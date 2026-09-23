import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "./config.js";
import { candidates, reconcile } from "./evidence.js";
import {
  candidateTable,
  clean,
  coverageText,
  history,
  overview,
} from "./render.js";
import { Collector } from "./sources.js";
import { errorMessage, fullSha } from "./types.js";
import type { Config, Snapshot } from "./types.js";

export const HELP = `Read-only GitHub/Vercel deployment evidence. See docs/operations-cli.md.
Usage: bun run ops [overview|history|candidates] [options]
  --repo OWNER/REPO   Default: GH_REPO, configuration, then origin
  --config FILE      JSON project mapping (no credentials)
  --app NAME         Filter one app directory/configured application
  --sha FULL_SHA     Exact 40-character commit SHA; prefixes rejected
  --limit N          Rows per history section / runs per workflow (default 10)
  --pages N          Max pages per paginated source (default 3)
  --no-vercel        Explicitly skip Vercel; missing evidence remains visible
  --json             Full SHAs, links, coverage and evidence caveats
  --help             Show this help (no API calls)
`;
export interface Options {
  view: "overview" | "history" | "candidates";
  repo?: string;
  config?: string;
  app?: string;
  sha?: string;
  limit: number;
  pages: number;
  noVercel: boolean;
  json: boolean;
  help: boolean;
}
export function options(argv: string[]): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      repo: { type: "string" },
      config: { type: "string" },
      app: { type: "string" },
      sha: { type: "string" },
      limit: { type: "string", default: "10" },
      pages: { type: "string", default: "3" },
      "no-vercel": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const view = positionals[0] ?? "overview";
  if (
    positionals.length > 1 ||
    !["overview", "history", "candidates"].includes(view)
  )
    throw new Error(
      "View must be overview, history or candidates; no mutation commands exist",
    );
  const positive = (value: string): number => {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100)
      throw new Error("Expected an integer from 1 to 100");
    return Number(value);
  };
  if (values.sha && !fullSha(values.sha))
    throw new Error(
      "Use a full 40-character commit SHA; prefixes are ambiguous",
    );
  return {
    view: view as Options["view"],
    repo: values.repo,
    config: values.config,
    app: values.app,
    sha: fullSha(values.sha) ?? undefined,
    limit: positive(values.limit!),
    pages: positive(values.pages!),
    noVercel: values["no-vercel"]!,
    json: values.json!,
    help: values.help!,
  };
}
export interface Dependencies {
  config: typeof loadConfig;
  collect: (config: Config, args: Options) => Promise<Snapshot>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}
const dependencies: Dependencies = {
  config: loadConfig,
  collect: (config, args) =>
    new Collector(config, args.limit, args.pages).collect(
      args.sha,
      args.noVercel,
    ),
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
};
export async function main(
  argv: string[] = process.argv.slice(2),
  injected: Partial<Dependencies> = {},
): Promise<number> {
  const io = { ...dependencies, ...injected };
  let args: Options;
  try {
    args = options(argv);
  } catch (error) {
    io.stderr(`ops: ${clean(errorMessage(error))}`);
    return 2;
  }
  if (args.help) {
    io.stdout(HELP);
    return 0;
  }
  try {
    const config = io.config(args.config, args.repo);
    if (args.app && !config.apps.includes(args.app))
      throw new ConfigError(
        "Unknown --app; use an app directory name or configure its projects",
      );
    const apps = args.app ? [args.app] : config.apps;
    const snapshot = await io.collect({ ...config, apps }, args);
    const events = reconcile(snapshot, apps);
    for (const e of events)
      for (const note of e.notes)
        if (/conflict/i.test(note))
          snapshot.coverage.push({
            source: e.id,
            state: "partial",
            detail: note,
          });
    snapshot.coverage.sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.state.localeCompare(b.state) ||
        a.detail.localeCompare(b.detail),
    );
    const selected = events.filter(
      (e) =>
        (!args.sha || e.sha === args.sha) &&
        (!args.app || e.app === null || e.app === args.app),
    );
    const rows = candidates(snapshot, events, apps, args.limit, args.sha);
    const report = {
      schema_version: 1,
      repo: config.repo,
      view: args.view,
      gathered_at: snapshot.gathered_at,
      coverage: snapshot.coverage,
      events: selected,
      candidates: rows,
      limitations: [
        "Bounded, non-atomic snapshot; absent evidence is not proof of absence",
        "Build/resolution job success does not prove a new build",
        "Short display SHAs are never used for joins; JSON and candidates carry full SHAs",
        "Dispatch head SHA and manifest github.sha can differ from checked-out/deployed SHA",
        "Artifacts are content-addressed; no reuse inferred from timestamp or same-checkout uploads",
        "No archive download, checksum/SLSA verification or live health checks",
      ],
    };
    if (args.json) io.stdout(JSON.stringify(report, null, 2));
    else {
      const view =
        args.view === "overview"
          ? overview(selected, apps)
          : args.view === "history"
            ? history(selected, args.limit)
            : candidateTable(rows);
      io.stdout(
        `Operations evidence: ${config.repo} | observed ${snapshot.gathered_at}\n\n${view}\n\n${coverageText(snapshot.coverage)}`,
      );
    }
    return snapshot.coverage.some((c) =>
      ["unavailable", "partial"].includes(c.state),
    )
      ? 2
      : 0;
  } catch (error) {
    io.stderr(
      error instanceof ConfigError
        ? `ops: ${error.message}`
        : "ops: unexpected runtime error; check prerequisites (details suppressed to protect credentials)",
    );
    return 1;
  }
}
if (require.main === module)
  void main().then((code) => {
    process.exitCode = code;
  });
