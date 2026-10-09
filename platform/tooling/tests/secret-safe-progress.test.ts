import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync, statSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runner = join(root, "platform/tooling/e2e/secret-safe-playwright.ts");
const marker = "PRIVATE_SYNTHETIC_PASSWORD_TOTP_RECOVERY_TOKEN";
const fixtures: string[] = [];
after(() => { for (const dir of fixtures) rmSync(dir, { recursive: true, force: true }); });
const delay = (ms: number) => new Promise(done => setTimeout(done, ms));
async function until(check: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() >= end) throw new Error("Synthetic child checkpoint missing"); await delay(20); }
}
function fixture(body: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "safe-progress-probe-")));
  fixtures.push(dir);
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }), { mode: 0o600 });
  writeFileSync(join(dir, "playwright.config.ts"), `export default { testDir: '.', workers: 1, retries: 0, timeout: 30000, use: { trace: 'off', screenshot: 'off', video: 'off' } };\n`, { mode: 0o600 });
  writeFileSync(join(dir, "probe.spec.ts"), `import { test, expect } from '@playwright/test';\nimport { writeFileSync } from 'node:fs';\n${body}`, { mode: 0o600 });
  return dir;
}
function launch(dir: string, format = "json") {
  const child = spawn(process.execPath, [runner, "--config", join(dir, "playwright.config.ts"), `--reporter=${format}`], {
    cwd: root, env: { ...process.env, E2E_SAFE_REPORT_DIR: join(dir, "safe"), TEST_WORKER_INDEX: undefined, TEST_PARALLEL_INDEX: undefined }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  writeFileSync(join(dir, "runner-start.json"), JSON.stringify({ pid: child.pid, format }), { mode: 0o600 });
  const done = new Promise<number | null>(resolve => child.on("close", (code, signal) => {
    writeFileSync(join(dir, "runner-end.json"), JSON.stringify({ pid: child.pid, code, signal }), { mode: 0o600 });
    writeFileSync(join(dir, "runner-output.json"), JSON.stringify({ stdout, stderr }), { mode: 0o600 }); resolve(code);
  }));
  return { child, done, output: () => ({ stdout, stderr }) };
}

test("real child publishes completed failure and next start before interrupted suite exit", { timeout: 25000 }, async () => {
  const dir = fixture(`test('first ${marker}', async () => { console.log('${marker}'); await test.step('org-row-absent', async () => {}); expect(1).toBe(2); });\ntest('unfinished ${marker}', async () => { writeFileSync(new URL('./started.json', import.meta.url), JSON.stringify({ parent: process.ppid, worker: process.pid })); await new Promise(() => {}); });\n`);
  const run = launch(dir);
  let hadProgress: boolean; let exit: number | null;
  try {
    await until(() => existsSync(join(dir, "started.json")));
    await delay(100);
    hadProgress = existsSync(join(dir, "safe/progress.ndjson")) && statSync(join(dir, "safe/progress.ndjson")).size > 0;
    if (hadProgress) {
      const checkpoint = JSON.parse(readFileSync(join(dir, "safe/progress.json"), "utf8"));
      assert.equal(checkpoint.complete, false); assert.deepEqual(checkpoint.events, []);
      const records = readFileSync(join(dir, "safe/progress.ndjson"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.ok(records.every(record => record.complete === false));
      const progress = { events: records.map(record => record.event) };
      assert.equal(progress.events.filter((e: { kind: string }) => e.kind === "end").length, 1);
      assert.equal(progress.events.at(-1).kind, "start");
      assert.match(run.output().stderr, /org-row-absent/);
      assert.ok(!run.output().stderr.includes(marker));
    }
  } finally { run.child.kill("SIGTERM"); exit = await run.done; }
  assert.equal(exit, 143);
  assert.ok(hadProgress, "completed attempts and current start must survive before onEnd");
  assert.equal(JSON.parse(run.output().stdout).status, "interrupted");
  assert.ok(!JSON.stringify(run.output()).includes(marker));
});

const { ProgressChannel, ProgressWriter, progressLimits, validateProgress } = await import("../e2e/secret-safe-progress.ts");
const loc = { number: 1, file: "qa/e2e/probe.spec.ts", line: 12, column: 3 };
const ended = { kind: "end", test: loc, attempt: { status: "failed", expectedStatus: "passed", retry: 0, durationMs: 45, diagnostics: ["assertion"], activities: { "org-row-absent": 1 }, failures: [{ file: "qa/e2e/probe.spec.ts", line: 99, column: 2, category: "assertion" }] } } as const;
const start = { kind: "start", test: loc, retry: 0 } as const;
const suite = { kind: "suite", tests: 2 } as const;
function frame(event: unknown, sequence = 1, run = "own-run") { return Buffer.from(JSON.stringify({ version: 1, run, sequence, event }) + "\n"); }

test("strict progress projection reuses report categories and refuses extra/private metadata", () => {
  assert.deepEqual(validateProgress(ended), ended);
  const invalid = [null, { ...start, title: marker }, { ...start, test: { ...loc, id: marker } }, { ...start, test: { ...loc, file: `https://host/?token=${marker}` } },
    { ...start, retry: marker }, { ...start, retry: -1 }, { ...start, retry: 101 }, { ...start, test: { ...loc, number: 0 } },
    { ...ended, attempt: { ...ended.attempt, status: marker } }, { ...ended, attempt: { ...ended.attempt, error: marker } },
    { ...ended, attempt: { ...ended.attempt, diagnostics: [marker] } }, { ...ended, attempt: { ...ended.attempt, activities: { [marker]: 1 } } },
    { ...ended, attempt: { ...ended.attempt, failures: [{ ...ended.attempt.failures[0], value: marker }] } },
    { ...ended, attempt: { ...ended.attempt, durationMs: NaN } }, { ...ended, attempt: { ...ended.attempt, diagnostics: Array(65).fill("runtime") } },
    { ...ended, attempt: { ...ended.attempt, failures: Array(129).fill(ended.attempt.failures[0]) } }];
  for (const value of invalid) assert.throws(() => validateProgress(value), error => error instanceof Error && /^Invalid (safe (progress|category|number|report|list|version)|source file)$/.test(error.message) && !error.message.includes(marker));
});

test("fragmented frames preserve source correlation, interleaved cases and real retries", () => {
  const seen: unknown[] = []; const channel = new ProgressChannel("own-run", event => { if (event) seen.push(event); });
  const second = { ...loc, number: 2, line: 25 };
  const events = [suite, start, { ...start, test: second }, { ...ended, test: second }, ended, { ...start, retry: 1 }, { ...ended, attempt: { ...ended.attempt, retry: 1, status: "passed", diagnostics: [], failures: [] } }];
  const bytes = Buffer.concat(events.map((e, i) => frame(e, i + 1)));
  for (const byte of bytes) channel.feed(Buffer.from([byte]));
  channel.finish();
  assert.equal(channel.rejected, false); assert.deepEqual(seen, events);
  assert.equal(channel.snapshot().complete, false); assert.equal(channel.snapshot().channel, "closed"); assert.deepEqual(channel.snapshot().inFlight, []);
});

test("correlation errors close the channel once without reflecting rejected values", () => {
  const attacks = [frame(start), frame(suite, 2), frame(suite, 1, marker), frame({ ...suite, secret: marker }), Buffer.from('{"version":1,"run":"own-run","sequence":1,"event":{},"title":"'+marker+'"}\n'),
    Buffer.concat([frame(suite), frame(ended, 2)]), Buffer.concat([frame(suite), frame(start, 2), frame(start, 3)]),
    Buffer.concat([frame(suite), frame(start, 2), frame({ ...ended, test: { ...loc, line: 13 } }, 3)]),
    Buffer.concat([frame(suite), frame(start, 2), frame({ ...ended, attempt: { ...ended.attempt, retry: 1 } }, 3)]),
    Buffer.concat([frame(suite), frame(start, 2), frame(ended, 3), frame(ended, 4)]),
    Buffer.concat([frame(suite), frame(start, 2), frame(ended, 3), frame({ ...start, retry: 2 }, 4)]),
    Buffer.concat([frame(suite), frame({ ...start, test: { ...loc, number: 3 } }, 2)]),
    Buffer.concat([frame(suite), frame(suite, 2)]), frame(suite).subarray(0, 10), Buffer.from([255, 10])];
  for (const bytes of attacks) {
    let rejections = 0; const channel = new ProgressChannel("own-run", event => { if (!event) rejections++; });
    channel.feed(bytes); channel.finish(); channel.feed(frame(suite)); channel.finish();
    assert.equal(channel.rejected, true); assert.equal(rejections, 1); assert.ok(!JSON.stringify(channel.snapshot()).includes(marker));
  }
});

test("frames, stream, inventory and publication are bounded", () => {
  for (const bytes of [Buffer.alloc(progressLimits.frameBytes + 1, 65), Buffer.alloc(progressLimits.streamBytes + 1, 65), frame({ kind: "suite", tests: 10001 })]) {
    const c = new ProgressChannel("own-run", () => {}); c.feed(bytes); assert.equal(c.rejected, true); assert.deepEqual(c.snapshot().events, []);
  }
  const c = new ProgressChannel("own-run", () => {}); c.feed(frame({ kind: "suite", tests: 10000 }));
  for (let n = 1; n <= 10000; n++) { c.feed(frame({ ...start, test: { ...loc, number: n } }, n * 2)); c.feed(frame({ ...ended, test: { ...loc, number: n } }, n * 2 + 1)); }
  assert.equal(c.rejected, true); assert.equal(c.snapshot().events.length, progressLimits.events);
  assert.throws(() => new ProgressWriter("own-run", () => 1).send(suite));
  assert.throws(() => new ProgressWriter("own-run", () => { throw new Error(marker); }).send(suite));
});

test("real child formats retain original outcomes, attempts and marker-free JSON stdout", { timeout: 25000 }, async () => {
  for (const format of ["json", "list", "github", "html"]) {
    const dir = fixture(`test('first ${marker}', async () => { console.log('${marker}'); console.error('${marker}'); await test.step('org-row-absent', async () => {}); await test.info().attach('${marker}', { body: Buffer.from('${marker}'), contentType: 'text/plain' }); expect(1).toBe(2); });\ntest('pass ${marker}', async () => {});\ntest.skip('skip ${marker}', async () => {});`);
    const run = launch(dir, format); assert.equal(await run.done, 1);
    const progress = JSON.parse(readFileSync(join(dir, "safe/progress.json"), "utf8"));
    assert.equal(progress.channel, "closed"); assert.equal(progress.complete, false); assert.equal(progress.events.filter((e: { kind: string }) => e.kind === "end").length, 3);
    assert.equal(progress.events.find((e: { kind: string }) => e.kind === "end").attempt.failures.at(-1).category, "assertion");
    assert.equal(JSON.parse(readFileSync(join(dir, "safe/report.json"), "utf8")).status, "failed");
    if (format === "json") assert.equal(JSON.parse(run.output().stdout).status, "failed");
    assert.ok(!JSON.stringify(run.output()).includes(marker));
    for (const file of ["progress.json", "progress.ndjson", "report.json", "index.html"]) assert.ok(!readFileSync(join(dir, "safe", file), "utf8").includes(marker));
  }
});

test("real child passing retry remains authoritative and progress remains incomplete", { timeout: 20000 }, async () => {
  const dir = fixture(`test('retry', async () => { expect(test.info().retry).toBe(1); });`);
  const config = join(dir, "playwright.config.ts"); writeFileSync(config, readFileSync(config, "utf8").replace("retries: 0", "retries: 1"));
  const run = launch(dir); assert.equal(await run.done, 0);
  const report = JSON.parse(run.output().stdout); assert.equal(report.status, "passed"); assert.equal(report.tests[0].outcome, "flaky"); assert.deepEqual(report.tests[0].attempts.map((a: { status: string }) => a.status), ["failed", "passed"]);
  const progress = JSON.parse(readFileSync(join(dir, "safe/progress.json"), "utf8")); assert.equal(progress.complete, false); assert.deepEqual(progress.events.filter((e: { kind: string }) => e.kind === "end").map((e: { attempt: { retry: number } }) => e.attempt.retry), [0, 1]);
});

test("real malformed private channel cannot make passing children a passing run", { timeout: 15000 }, async () => {
  const dir = fixture(`test('otherwise passes', async () => {});`);
  const config = join(dir, "playwright.config.ts"); writeFileSync(config, `import { writeSync } from 'node:fs';\nif (!process.env.TEST_WORKER_INDEX) { try { writeSync(3, '${marker}\\n'); } catch {} }\n` + readFileSync(config, "utf8"));
  const run = launch(dir); assert.equal(await run.done, 1); const report = JSON.parse(run.output().stdout);
  assert.equal(report.tests[0].attempts[0].status, "passed"); assert.equal(report.status, "failed"); assert.ok(report.globalErrors.includes("runtime"));
  const progress = JSON.parse(readFileSync(join(dir, "safe/progress.json"), "utf8")); assert.equal(progress.channel, "rejected"); assert.ok(!JSON.stringify(run.output()).includes(marker)); assert.ok(!JSON.stringify(progress).includes(marker));
});

test("real SIGINT and hard child termination retain incomplete observations without inventing results", { timeout: 25000 }, async () => {
  for (const signal of ["SIGINT", "SIGKILL"] as const) {
    const dir = fixture(`test('done', async () => {});\ntest('running', async () => { writeFileSync(new URL('./started.json', import.meta.url), JSON.stringify({ parent: process.ppid, worker: process.pid })); await new Promise(() => {}); });`);
    const run = launch(dir); let worker = 0;
    try {
      await until(() => existsSync(join(dir, "started.json")));
      const pids = JSON.parse(readFileSync(join(dir, "started.json"), "utf8")); worker = pids.worker;
      await until(() => JSON.parse(readFileSync(join(dir, "safe/progress.ndjson"), "utf8").trim().split("\n").at(-1)!).event.kind === "start");
      if (signal === "SIGKILL") process.kill(pids.parent, signal); else run.child.kill(signal);
      assert.equal(await run.done, signal === "SIGINT" ? 130 : 1);
      const progress = JSON.parse(readFileSync(join(dir, "safe/progress.json"), "utf8")); assert.equal(progress.complete, false);
      const report = JSON.parse(run.output().stdout); assert.equal(report.status, signal === "SIGINT" ? "interrupted" : "failed");
      if (signal === "SIGKILL") { assert.equal(progress.events.filter((e: { kind: string }) => e.kind === "end").length, 1); assert.equal(progress.inFlight.length, 1); assert.deepEqual(report.tests, []); }
    } finally {
      run.child.kill("SIGTERM"); if (worker) { try { process.kill(worker, "SIGTERM"); } catch { /* This owned worker already exited. */ } } await run.done;
    }
  }
});

test("canonical framing rejects duplicate keys, whitespace and malformed UTF8", () => {
  for (const bytes of [Buffer.from('{"version":1,"run":"wrong","run":"own-run","sequence":1,"event":{"kind":"suite","tests":0}}\n'), Buffer.from(' ' + frame(suite).toString()), Buffer.concat([Buffer.from('{"version":1,"run":"'), Buffer.from([255]), Buffer.from('","sequence":1,"event":{"kind":"suite","tests":0}}\n')])]) {
    const channel = new ProgressChannel("own-run", () => {}); channel.feed(bytes); assert.equal(channel.rejected, true); assert.deepEqual(channel.snapshot().events, []);
  }
});

test("new progress artifact preserves dedicated-directory link refusal and stale-verdict reset", { timeout: 15000 }, async () => {
  const dir = fixture(`test('passes', async () => {});`); const safe = join(dir, "safe"); mkdirSync(safe);
  const victim = join(dir, "victim.txt"); writeFileSync(victim, marker, { mode: 0o600 }); symlinkSync(victim, join(safe, "progress.json"));
  const run = launch(dir); assert.equal(await run.done, 2); assert.equal(readFileSync(victim, "utf8"), marker); assert.ok(!JSON.stringify(run.output()).includes(marker));
  const other = fixture(`test('passes', async () => {});`); mkdirSync(join(other, "safe")); writeFileSync(join(other, "safe/report.json"), '{"status":"passed"}'); writeFileSync(join(other, "safe/progress.json"), '{"complete":true}');
  const failed = spawn(process.execPath, [runner, "--reporter=blob"], { cwd: root, env: { ...process.env, E2E_SAFE_REPORT_DIR: join(other, "safe") }, stdio: "ignore" });
  assert.equal(await new Promise(resolve => failed.on("close", resolve)), 2);
  assert.equal(JSON.parse(readFileSync(join(other, "safe/report.json"), "utf8")).status, "failed");
  const checkpoint = JSON.parse(readFileSync(join(other, "safe/progress.json"), "utf8")); assert.equal(checkpoint.complete, false); assert.deepEqual(checkpoint.events, []);
});

test("raw JSON-looking child output is never a progress channel and capture policy still fails", { timeout: 15000 }, async () => {
  const dir = fixture(`test('passes', async () => { console.log(JSON.stringify({ version: 1, run: process.env.E2E_SAFE_PROGRESS_RUN, sequence: 1, event: { kind: 'suite', tests: 9999, title: '${marker}' } })); });`);
  const run = launch(dir); assert.equal(await run.done, 0);
  const progress = JSON.parse(readFileSync(join(dir, "safe/progress.json"), "utf8")); assert.equal(progress.events[0].tests, 1); assert.equal(progress.events.length, 3); assert.ok(!JSON.stringify(run.output()).includes(marker));
  const unsafe = fixture(`test('does not request browser', async () => {});`); const config = join(unsafe, "playwright.config.ts"); writeFileSync(config, readFileSync(config, "utf8").replace("video: 'off'", "video: 'on'"));
  const blocked = launch(unsafe); assert.equal(await blocked.done, 1); const report = JSON.parse(blocked.output().stdout); assert.equal(report.status, "failed"); assert.ok(report.globalErrors.includes("capture-policy"));
});

test("whole-wrapper termination leaves only explicitly incomplete closed journal records", { timeout: 20000 }, async () => {
  const dir = fixture(`test('completed failure', async () => { await test.step('org-row-not-pending', async () => {}); expect(1).toBe(2); });\ntest('not completed', async () => { writeFileSync(new URL('./started.json', import.meta.url), JSON.stringify({ parent: process.ppid, worker: process.pid })); await new Promise(() => {}); });`);
  const run = launch(dir); let owned: number[] = [];
  try {
    await until(() => existsSync(join(dir, "started.json")));
    owned = Object.values(JSON.parse(readFileSync(join(dir, "started.json"), "utf8")));
    await until(() => readFileSync(join(dir, "safe/progress.ndjson"), "utf8").trim().split("\n").length === 4);
    run.child.kill("SIGKILL"); assert.equal(await run.done, null);
    const raw = readFileSync(join(dir, "safe/progress.ndjson"));
    const completeLines = (bytes: Buffer) => bytes.subarray(0, bytes.lastIndexOf(10) + 1).toString().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const records = completeLines(raw); assert.equal(records.length, 4); assert.ok(records.every(r => r.complete === false));
    assert.equal(records[2].event.kind, "end"); assert.equal(records[2].event.attempt.status, "failed"); assert.equal(records[2].event.attempt.activities["org-row-not-pending"], 1);
    assert.equal(records[3].event.kind, "start"); assert.equal(records[3].event.attempt, undefined);
    assert.equal(completeLines(raw.subarray(0, raw.length - 8)).length, 3); // A torn last record confers no result.
    assert.equal(JSON.parse(readFileSync(join(dir, "safe/progress.json"), "utf8")).complete, false);
    assert.equal(JSON.parse(readFileSync(join(dir, "safe/report.json"), "utf8")).status, "failed");
    assert.match(run.output().stderr, /org-row-not-pending/);
  } finally {
    run.child.kill("SIGTERM");
    for (const pid of owned) { try { process.kill(pid, "SIGTERM"); } catch { /* Exact owned child already exited. */ } }
    await run.done;
  }
});

test("journal link is refused and real publication grows by one record per event", { timeout: 20000 }, async () => {
  const dir = fixture(`for (let n = 0; n < 200; n++) test('case ' + n, async () => {});`);
  const run = launch(dir); assert.equal(await run.done, 0);
  const journal = readFileSync(join(dir, "safe/progress.ndjson"), "utf8"); const records = journal.trim().split("\n").map(line => JSON.parse(line));
  const snapshot = JSON.parse(readFileSync(join(dir, "safe/progress.json"), "utf8"));
  assert.equal(records.length, 401); assert.deepEqual(records.map(record => record.event), snapshot.events);
  assert.ok(Buffer.byteLength(journal) < 160000); assert.ok(records.every(record => record.complete === false));
  assert.equal(statSync(join(dir, "safe/progress.ndjson")).mode & 0o777, 0o600);
  const blocked = fixture(`test('passes', async () => {});`); mkdirSync(join(blocked, "safe")); const victim = join(blocked, "victim"); writeFileSync(victim, marker); symlinkSync(victim, join(blocked, "safe/progress.ndjson"));
  const refused = launch(blocked); assert.equal(await refused.done, 2); assert.equal(readFileSync(victim, "utf8"), marker);
});

test("emitter stops at its byte budget before writing further frames", () => {
  let emitted = 0; const writer = new ProgressWriter("own-run", bytes => { emitted += bytes.length; return bytes.length; });
  const failure = { file: "a".repeat(230) + ".ts", line: 1, column: 1, category: "assertion" as const };
  const event = validateProgress({ ...ended, attempt: { ...ended.attempt, failures: Array(128).fill(failure) } });
  assert.throws(() => { for (let n = 0; n < progressLimits.events; n++) writer.send(event); }, /Invalid safe progress/);
  assert.ok(emitted <= progressLimits.streamBytes); const previous = emitted;
  assert.throws(() => writer.send(event)); assert.equal(emitted, previous);
});
