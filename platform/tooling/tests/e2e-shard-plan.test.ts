import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { estimate, main, planShards, recordDurations, specFiles } from "../e2e-shard-plan.ts";
import type { SafeReport } from "../e2e/secret-safe-report.ts";

const files = [
  { file: "a.spec.ts", tests: 2 },
  { file: "b.spec.ts", tests: 6 },
  { file: "c.spec.ts", tests: 30 },
  { file: "d.spec.ts", tests: 4 },
  { file: "e.spec.ts", tests: 7 },
];

function listing(entries: { file: string; durations: number[] }[]) {
  return {
    suites: entries.map(({ file, durations }) => ({
      file,
      specs: durations.map((duration) => ({ file, tests: [{ results: [{ duration: duration * 2 }, { duration }] }] })),
    })),
  };
}

test("every file lands in exactly one shard, whole", () => {
  const plan = planShards(files, { "b.spec.ts": 150, "c.spec.ts": 30, "d.spec.ts": 70 }, 3);
  const assigned = plan.flatMap((shard) => shard.files).sort();
  assert.deepEqual(assigned, files.map((f) => f.file));
});

test("slow files are spread across shards instead of sliced by test count", () => {
  const plan = planShards(files, { "a.spec.ts": 5, "b.spec.ts": 150, "c.spec.ts": 30, "d.spec.ts": 70, "e.spec.ts": 100 }, 3);
  const seconds = plan.map((shard) => shard.seconds);
  // 355s over 3 shards, but b alone takes 150s: the slowest shard can't beat that.
  assert.deepEqual(seconds, [150, 105, 100]);
  assert.ok(plan.every((shard) => shard.files.length > 0));
});

test("the plan is deterministic, so independent shards agree", () => {
  const durations = { "b.spec.ts": 50, "c.spec.ts": 50, "d.spec.ts": 50 };
  assert.deepEqual(planShards(files, durations, 4), planShards([...files].reverse(), durations, 4));
});

test("unrecorded files are estimated from the recorded mean per test, or by test count", () => {
  const weights = estimate(files, { "b.spec.ts": 60, "d.spec.ts": 40 });
  assert.equal(weights.get("b.spec.ts"), 60);
  assert.equal(weights.get("c.spec.ts"), 300); // 30 tests at (60 + 40) / (6 + 4) seconds
  assert.equal(estimate(files, {}).get("e.spec.ts"), 7);
});

test("more shards than files leaves the extra shards empty", () => {
  const plan = planShards(files.slice(0, 2), {}, 4);
  assert.deepEqual(plan.map((shard) => shard.files.length), [1, 1, 0, 0]);
  assert.throws(() => planShards(files, {}, 0), /positive integer/);
});

test("reads files from a listing and durations from a report's final attempts", () => {
  const report = listing([{ file: "x.spec.ts", durations: [1500, 2500] }, { file: "y.spec.ts", durations: [200] }]);
  assert.deepEqual(specFiles(report), [{ file: "x.spec.ts", tests: 2 }, { file: "y.spec.ts", tests: 1 }]);
  assert.deepEqual(recordDurations(report), { "x.spec.ts": 4, "y.spec.ts": 1 });
});

test("plan writes this shard's test list", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-shard-plan-"));
  writeFileSync(path.join(dir, "list.json"), JSON.stringify(listing(files.map(({ file, tests }) => ({ file, durations: Array(tests).fill(0) })))));
  writeFileSync(path.join(dir, "durations.json"), JSON.stringify({ "c.spec.ts": 200, "b.spec.ts": 10, "e.spec.ts": 10 }));
  const lines: string[] = [];
  const lists = [1, 2].map((shard) => {
    const out = path.join(dir, `shard-${shard}.txt`);
    assert.equal(main(["plan", "--list", path.join(dir, "list.json"), "--durations", path.join(dir, "durations.json"), "--shard", `${shard}/2`, "--out", out], (line) => lines.push(line)), 0);
    return readFileSync(out, "utf8").trim().split("\n");
  });
  assert.deepEqual(lists[0], ["c.spec.ts"]);
  assert.deepEqual([...lists[0]!, ...lists[1]!].sort(), files.map((f) => f.file));
  assert.match(lines[0]!, /durations from durations\.json/);
  assert.throws(() => main(["plan", "--list", "x", "--shard", "3/2", "--out", "y"]), /out of range/);
});

test("safe reports retain final-attempt duration weights without raw Playwright values", () => {
  const attempt = (durationMs: number, retry: number) => ({ status: "passed" as const, expectedStatus: "passed" as const, retry, durationMs, diagnostics: [], activities: {}, failures: [] });
  const report: SafeReport = { version: 1, status: "passed", globalErrors: [], suppressedOutputBytes: 0, tests: [
    { number: 1, file: "auth.spec.ts", line: 1, column: 1, outcome: "flaky", attempts: [attempt(90_000, 0), attempt(2000, 1)] },
    { number: 2, file: "auth.spec.ts", line: 2, column: 1, outcome: "expected", attempts: [attempt(3000, 0)] },
  ] };
  assert.deepEqual(recordDurations(report), { "auth.spec.ts": 5 });
  assert.throws(() => recordDurations({ ...report, version: 2 } as unknown as SafeReport), /Invalid safe version/);
});

