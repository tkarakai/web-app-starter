// Balance sharded Playwright E2E runs by duration, not test count.
//
// Playwright's --shard slices the ordered test list into equal counts, so slow files that sort
// together (auth-*) land in one shard while others idle. This plans whole files per shard
// (serial suites can't be split) with longest-first greedy assignment over recorded durations,
// and writes a --test-list file for one shard. Every shard computes the same plan from the
// same commit, so each test runs exactly once.
//
// Usage (from the app directory, e.g. apps/web):
//   playwright test --list --reporter=json --project=chromium > list.json
//   node-ts.sh platform/tooling/e2e-shard-plan.ts plan --list list.json --shard 2/4 \
//     [--durations qa/e2e/shard-durations.json] --out shard.txt
//   bun run test:e2e --reporter=json                   # safe report: qa/safe-e2e-report/report.json
//   node-ts.sh platform/tooling/e2e-shard-plan.ts record --report report.json --out qa/e2e/shard-durations.json
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateReport, type SafeReport } from "./e2e/secret-safe-report.ts";

/** One spec file and how many tests it holds, from `playwright test --list --reporter=json`. */
export interface SpecFile {
  file: string;
  tests: number;
}

interface JsonSuite {
  file?: string;
  specs?: { file: string; tests: { results?: { duration: number }[] }[] }[];
  suites?: JsonSuite[];
}

function walk(suite: JsonSuite, visit: (file: string, tests: { results?: { duration: number }[] }[]) => void): void {
  for (const spec of suite.specs ?? []) visit(spec.file, spec.tests);
  for (const child of suite.suites ?? []) walk(child, visit);
}

/** Spec files and test counts from a Playwright JSON listing or report. */
export function specFiles(report: { suites?: JsonSuite[] }): SpecFile[] {
  const counts = new Map<string, number>();
  for (const suite of report.suites ?? []) {
    walk(suite, (file, tests) => counts.set(file, (counts.get(file) ?? 0) + tests.length));
  }
  return [...counts].map(([file, tests]) => ({ file, tests })).sort((a, b) => a.file.localeCompare(b.file));
}

/** Seconds per spec file from a Playwright JSON report: each test's final attempt. */
export function recordDurations(report: { suites?: JsonSuite[] } | SafeReport): Record<string, number> {
  const seconds = new Map<string, number>();
  if ("version" in report) {
    for (const test of validateReport(report).tests) {
      const last = test.attempts.at(-1);
      if (last) seconds.set(test.file, (seconds.get(test.file) ?? 0) + last.durationMs / 1000);
    }
  } else for (const suite of report.suites ?? []) {
    walk(suite, (file, tests) => {
      for (const test of tests) {
        const last = test.results?.at(-1);
        if (last) seconds.set(file, (seconds.get(file) ?? 0) + last.duration / 1000);
      }
    });
  }
  return Object.fromEntries([...seconds].sort(([a], [b]) => a.localeCompare(b)).map(([file, s]) => [file, Math.max(1, Math.round(s))]));
}

/**
 * Estimated seconds per file. A file without a recorded duration (new, or renamed) is estimated
 * from its test count at the recorded files' mean seconds per test; with no recordings at all,
 * every test counts as one unit.
 */
export function estimate(files: readonly SpecFile[], durations: Readonly<Record<string, number>>): Map<string, number> {
  const known = files.filter((f) => typeof durations[f.file] === "number" && f.tests > 0);
  const knownTests = known.reduce((sum, f) => sum + f.tests, 0);
  const perTest = knownTests > 0 ? known.reduce((sum, f) => sum + durations[f.file]!, 0) / knownTests : 1;
  return new Map(files.map((f) => [f.file, typeof durations[f.file] === "number" ? durations[f.file]! : f.tests * perTest]));
}

/** Longest-first greedy assignment of whole files to `total` shards; deterministic. */
export function planShards(files: readonly SpecFile[], durations: Readonly<Record<string, number>>, total: number): { files: string[]; seconds: number }[] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`Shard total must be a positive integer, got ${total}`);
  const weights = estimate(files, durations);
  const shards = Array.from({ length: total }, () => ({ files: [] as string[], seconds: 0 }));
  const ordered = files.filter((f) => f.tests > 0).sort((a, b) => weights.get(b.file)! - weights.get(a.file)! || a.file.localeCompare(b.file));
  for (const { file } of ordered) {
    let lightest = shards[0]!;
    for (const shard of shards) if (shard.seconds < lightest.seconds) lightest = shard;
    lightest.files.push(file);
    lightest.seconds += weights.get(file)!;
  }
  for (const shard of shards) shard.files.sort();
  return shards;
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function main(argv: readonly string[], out: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): number {
  const [command] = argv;
  if (command === "record") {
    const report = option(argv, "--report"), target = option(argv, "--out");
    if (!report || !target) throw new Error("record needs --report <playwright-json-report> --out <durations.json>");
    const durations = recordDurations(readJson(report) as { suites?: JsonSuite[] });
    writeFileSync(target, `${JSON.stringify(durations, null, 2)}\n`);
    out(`Recorded ${Object.keys(durations).length} spec files to ${target}`);
    return 0;
  }
  if (command === "plan") {
    const list = option(argv, "--list"), shardArg = option(argv, "--shard"), target = option(argv, "--out");
    const match = shardArg?.match(/^(\d+)\/(\d+)$/);
    if (!list || !match || !target) throw new Error("plan needs --list <playwright-json-listing> --shard <current>/<total> --out <test-list>");
    const current = Number(match[1]), total = Number(match[2]);
    if (current < 1 || current > total) throw new Error(`Shard ${shardArg} is out of range`);
    const durationsFile = option(argv, "--durations");
    const recorded = Boolean(durationsFile && existsSync(durationsFile));
    const durations = recorded ? readJson(durationsFile!) as Record<string, number> : {};
    const plan = planShards(specFiles(readJson(list) as { suites?: JsonSuite[] }), durations, total);
    const mine = plan[current - 1]!;
    writeFileSync(target, mine.files.map((file) => `${file}\n`).join(""));
    out(`E2E shard plan (${recorded ? `durations from ${path.basename(durationsFile!)}` : "no recorded durations: balanced by test count"}):`);
    const unit = recorded ? "s" : " tests";
    plan.forEach((shard, index) => out(`  ${index + 1 === current ? "*" : " "} shard ${index + 1}/${total}: ~${Math.round(shard.seconds)}${unit}, ${shard.files.join(", ") || "(none)"}`));
    return 0;
  }
  throw new Error("Usage: e2e-shard-plan.ts plan|record (see the header of this file)");
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
