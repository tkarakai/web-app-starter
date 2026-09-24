import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OperationsConsole, summary, type ConsoleDependencies } from "../src/console";
import { parseOptions, type Options } from "../src/options";
import type { Report } from "../src/operations";
import { operation, sessionStore, type Operation } from "../src/session";

const sha = "a".repeat(40);
const saved: Operation = { repository: "team/repo", environment: "production", sha, workflow: "cd-production.yml", workflowRef: "main",
  requestId: "request-123", startedAt: "2026-09-23T12:00:00Z", operation: "deploy", accepted: false };
const report = (data: Report["data"]): Report => ({ data, errors: [], warnings: [], coverage: [], observedAt: "2026-09-23T12:00:00Z" });
type Step = [title: string, choice: string, waitFor?: string, highlight?: number];
function harness(steps: Step[], overrides: Partial<ConsoleDependencies> = {}, answers: string[] = []) {
  const calls: Options[] = [], events: string[] = [], snapshots: string[][] = [];
  const initialSelections: { title: string; index: number | undefined }[] = [];
  const deps: ConsoleDependencies = {
    ui: {
      select: async (title, choices, initial, options) => {
        const step = steps.shift();
        if (!step) throw new Error(`Unexpected screen: ${title}`);
        expect(title).toContain(step[0]);
        initialSelections.push({ title, index: initial });
        options?.onHighlight?.(step[3] ?? initial ?? 0);
        if (step[1] === "AUTO") {
          for (let n = 0; n < 2000 && !options?.complete?.(); n++) await new Promise(r => setTimeout(r, 1));
          expect(options?.complete?.()).toBe(true); return -2;
        }
        if (step[2]) {
          for (let n = 0; n < 100 && !options?.summary?.().join("\n").includes(step[2]); n++) await new Promise(r => setTimeout(r, 1));
          expect(options?.summary?.().join("\n")).toContain(step[2]);
        }
        snapshots.push(options?.summary?.() ?? []);
        if (title.includes("Choose a commit")) expect(new Set(choices.map(c => c.match(/^[a-f0-9]{8}/)?.[0]).filter(Boolean)).size)
          .toBe(choices.filter(c => /^[a-f0-9]{8}/.test(c)).length);
        if (title.startsWith("Confirm")) expect(initial).toBe(0);
        if (step[1] === "ESC") return -1;
        const selected = (options?.labels?.() ?? choices).findIndex(c => c.includes(step[1]));
        expect(selected).toBeGreaterThanOrEqual(0);
        return selected;
      },
      ask: async () => answers.shift() ?? "", tell: text => events.push(text), show: () => {},
    },
    query: async o => {
      calls.push(o);
      if (o.command === "deploy" || o.command === "rollback") {
        if (o.yes) { events.push("dispatch"); return report({ ...saved, environment: o.to, dispatched: true }); }
        return report({ ...saved, environment: o.to, dispatched: false });
      }
      if (o.command === "request") return report({ run: 42, attempt: 1 });
      if (o.command === "watch") return report({ status: "completed", conclusion: "success", attempt: 1 });
      if (o.command === "verify") return report({ outcome: "serving", rows: [] });
      if (o.command === "inspect") return report({ sha, ci: "success", stagingTag: true });
      if (o.command === "candidates" || o.command === "runs") return report({ rows: [{ sha, change: "Test release" }] });
      return report({ rows: [], workflows: [], deploymentTags: [] });
    },
    load: async () => undefined,
    save: async o => { events.push(o.runId ? "save-run" : o.accepted ? "save-accepted" : "save-before-write"); },
    setup: async () => { events.push("setup"); }, export: async () => { events.push("export"); },
    ...overrides,
  };
  return { app: new OperationsConsole(parseOptions(["status", "--watch", "--interval", "1"]), deps), calls, events, steps, snapshots, initialSelections };
}
test("repeated Escape cancels exit and restores the previous home selection", async () => {
  const h = harness([
    ["Operations", "ESC", undefined, 3], ["Exit operations", "ESC"],
    ["Operations", "ESC"], ["Exit operations", "Keep using ops"], ["Operations", "Quit"],
  ]);
  await h.app.run();
  expect(h.initialSelections.filter(s => s.title.startsWith("Operations")).map(s => s.index)).toEqual([0, 3, 3]);
  expect(h.initialSelections.filter(s => s.title.startsWith("Exit")).map(s => s.index)).toEqual([0, 0]);
  expect(h.calls.filter(o => o.command === "status")).toHaveLength(1);
  expect(h.calls.some(o => o.yes)).toBe(false); expect(h.steps).toHaveLength(0);
});
test("Escape exits only after explicitly selecting Exit ops", async () => {
  const h = harness([["Operations", "ESC"], ["Exit operations", "Exit ops"]]);
  await h.app.run(); expect(h.steps).toHaveLength(0); expect(h.calls.some(o => o.yes)).toBe(false);
});
test("exploration and Back navigation never authorize a deployment", async () => {
  const h = harness([
    ["Operations", "Monitor environments"], ["Scope", "All environments"], ["Monitor", "View full evidence"],
    ["Evidence details", "ESC"], ["Monitor", "Back"], ["Operations", "Quit"],
  ]);
  await h.app.run(); expect(h.steps).toHaveLength(0); expect(h.calls.some(o => o.yes)).toBe(false);
});
test("Back is the default at the write boundary; cancellation returns to review", async () => {
  const h = harness([
    ["Operations", "Deploy to production"], ["Choose a commit", "Test release"], ["deploy", "Continue to confirmation"],
    ["Confirm", "Back to review"], ["deploy", "ESC"], ["Choose a commit", "Back"], ["Operations", "Quit"],
  ]);
  await h.app.run(); expect(h.steps).toHaveLength(0); expect(h.calls.some(o => o.yes)).toBe(false); expect(h.events).not.toContain("save-before-write");
});
test("staging selection loads commit candidates and refreshes the same target", async () => {
  const h = harness([
    ["Operations", "Deploy to staging"], ["Choose a commit", "Refresh candidates"], ["Choose a commit", "Test release"],
    ["deploy", "Back"], ["Choose a commit", "Home"], ["Operations", "Quit"],
  ]);
  await h.app.run();
  expect(h.calls.filter(o => o.command === "candidates").map(o => o.to)).toEqual(["staging", "staging"]);
  expect(h.calls.some(o => o.command === "runs" || o.yes)).toBe(false);
  expect(h.calls.find(o => o.command === "inspect")).toMatchObject({ args: [sha], to: "staging" });
});
test("staging picker can reveal unchanged commits and exposes recorded per-app builds", async () => {
  const calls: Options[] = [];
  const h = harness([
    ["Operations", "Deploy to staging"], ["Choose a commit", "Show all recent commits", "1 commit hidden"],
    ["Choose a commit", "all apps unchanged"], ["deploy", "View recorded per-app build results"],
    ["Evidence details", "ESC"], ["deploy", "Back"], ["Choose a commit", "Show only artifact-producing commits"],
    ["Choose a commit", "Home", "1 commit hidden"], ["Operations", "Quit"],
  ], { query: async o => {
    calls.push(o);
    if (o.command === "candidates") return report({ sourceBranch: "main", hiddenWithoutProducedArtifacts: o.allCommits ? 0 : 1,
      rows: o.allCommits ? [{ sha, branch: "main", ci: "success", change: "Docs", artifactSummary: "all apps unchanged", appEvidence: [{ app: "web", result: "unchanged" }] }] : [] });
    if (o.command === "inspect") return report({ sha, rows: [] });
    return report({});
  } });
  await h.app.run();
  expect(calls.filter(o => o.command === "candidates").map(o => o.allCommits)).toEqual([false, true, false]);
  expect(calls.some(o => o.yes)).toBe(false);
});
test("production requires the typed environment after the explicit confirmation", async () => {
  const h = harness([
    ["Operations", "Deploy to production"], ["Choose a commit", "Test release"], ["deploy", "Continue to confirmation"],
    ["Confirm", "Confirm deploy"], ["deploy", "Back"], ["Choose a commit", "Back"], ["Operations", "Quit"],
  ], {}, ["staging"]);
  await h.app.run(); expect(h.calls.some(o => o.yes)).toBe(false); expect(h.events).toContain("No deployment requested.");
});
test("confirmed deployment saves identity before one write, then follows and verifies that operation", async () => {
  const h = harness([
    ["Operations", "Deploy to production"], ["Choose a commit", "Test release"], ["deploy", "Continue to confirmation"],
    ["Confirm", "Confirm deploy"], ["Watching", "AUTO"], ["Deployment complete", "Return Home", "COMPLETE"], ["Operations", "Quit"],
  ], {}, ["production"]);
  await h.app.run(); expect(h.steps).toHaveLength(0);
  expect(h.events.filter(e => e === "dispatch")).toHaveLength(1);
  expect(h.events.indexOf("save-before-write")).toBeLessThan(h.events.indexOf("dispatch"));
  expect(h.calls.find(o => o.yes)).toMatchObject({ args: [sha], to: "production", request: "request-123", expectedRepository: "team/repo" });
  expect(h.calls.find(o => o.command === "verify")).toMatchObject({ run: 42, attempt: 1, expectedSha: sha });
});
test("an uncertain saved request can be explored without redispatch", async () => {
  const calls: Options[] = [];
  const h = harness([
    ["Operations", "Watch"], ["Waiting for GitHub", "ESC"], ["Operations", "Quit"],
  ], { load: async () => saved, query: async o => { calls.push(o); return report(o.command === "request" ? { status: "not-observed" } : {}); } });
  await h.app.run(); expect(calls.some(o => o.yes || o.command === "deploy")).toBe(false);
  expect(calls.find(o => o.command === "request")).toMatchObject({ request: saved.requestId, expectedRepository: saved.repository });
});
test("resuming an attempt does not silently adopt a rerun", async () => {
  const calls: Options[] = [];
  const h = harness([
    ["Operations", "Watch"], ["Watching", "AUTO"], ["Deployment needs attention", "ESC", "new attempt"], ["Operations", "Quit"],
  ], { load: async () => ({ ...saved, runId: 42, attempt: 1 }), query: async o => {
    calls.push(o);
    return o.command === "watch" ? { ...report(null), errors: [{ code: "RUN_SUPERSEDED", message: "A new attempt exists", hint: "Inspect it", details: {} }] } : report({});
  } });
  await h.app.run(); expect(calls.find(o => o.command === "watch")?.attempt).toBe(1);
  expect(calls.some(o => o.command === "verify" || o.yes)).toBe(false);
});
test("an accepted request automatically advances when its run becomes visible", async () => {
  let lookups = 0;
  const calls: Options[] = [];
  const h = harness([
    ["Operations", "Watch"], ["Waiting for GitHub", "AUTO"], ["Watching", "AUTO"], ["Deployment complete", "Return Home", "COMPLETE"], ["Operations", "Quit"],
  ], { load: async () => ({ ...saved, accepted: true }), query: async o => {
    calls.push(o);
    if (o.command === "request") return report(++lookups === 1 ? {} : { run: 42, attempt: 1 });
    if (o.command === "watch") return report({ status: "completed", conclusion: "success", attempt: 1 });
    if (o.command === "verify") return report({ outcome: "serving" });
    return report({});
  } });
  await h.app.run(); expect(lookups).toBe(2); expect(calls.some(o => o.yes)).toBe(false);
});
test("watch stays passive through workflow and serving verification without selecting commands", async () => {
  let checks = 0;
  const calls: Options[] = [];
  const h = harness([
    ["Operations", "Watch"], ["Watching", "AUTO"], ["Deployment complete", "Return Home", "intended release is serving"], ["Operations", "Quit"],
  ], { load: async () => ({ ...saved, accepted: true, runId: 42, attempt: 1 }), query: async o => {
    calls.push(o);
    if (o.command === "watch") return report({ status: "completed", conclusion: "success", attempt: 1 });
    if (o.command === "verify") return report({ outcome: ++checks === 1 ? "incomplete" : "serving" });
    return report({});
  } });
  await h.app.run();
  expect(checks).toBe(2); expect(calls.some(o => o.yes)).toBe(false);
  expect(h.events.some(e => e.includes("bun run ops watch"))).toBe(false);
});
test("watch actions return to watching and failure produces a clear terminal result", async () => {
  const h = harness([
    ["Operations", "Watch"], ["Watching", "Deployment actions", "RUNNING"],
    ["Deployment actions", "Show resume command"], ["Watching", "AUTO"],
    ["Deployment failed", "Return Home", "STOPPED"], ["Operations", "Quit"],
  ], { load: async () => ({ ...saved, runId: 42, attempt: 1 }), query: (() => {
    let polls = 0;
    return async o => report(o.command === "watch" ? ++polls === 1
      ? { status: "in_progress", attempt: 1, rows: [{ job: "ci-web / E2E", status: "in_progress" }] }
      : { status: "completed", conclusion: "failure", attempt: 1, rows: [{ job: "ci-web / E2E", status: "completed", conclusion: "failure" }] } : {});
  })() });
  await h.app.run(); expect(h.events.some(e => e.includes("Returning to live watch automatically"))).toBe(true);
});
test("home remains navigable while provider reads are stuck", async () => {
  const h = harness([["Operations", "Quit"]], { query: () => new Promise(() => {}) });
  await h.app.run(); expect(h.steps).toHaveLength(0);
});
test("latest failed deployment is an actionable home choice pinned to its attempt", async () => {
  const calls: Options[] = [];
  const h = harness([
    ["Operations", "Investigate latest staging", "Latest staging deployment: failed"], ["Investigate", "Home"], ["Operations", "Quit"],
  ], { query: async o => {
    calls.push(o);
    return report(o.command === "status" ? { recentOperations: [{ environment: "staging", run: 35930126720, attempt: 2, conclusion: "failure" }] } : {});
  } });
  await h.app.run();
  expect(calls.find(o => o.command === "diagnose")).toMatchObject({ args: ["35930126720"], attempt: 2 });
  expect(calls.some(o => o.yes)).toBe(false);
});
test("normal history limits are not presented as home warnings; genuine read failures remain visible", () => {
  const value: Report = { ...report({}), coverage: [{ source: "recent workflows", state: "windowed", count: 3, limit: 3 }],
    errors: [{ code: "AUTH", message: "Cannot read staging", hint: "Check access", details: {} }] };
  expect(summary(value).join("\n")).not.toMatch(/bounded|absence|window/i);
  expect(summary(value).join("\n")).toContain("Cannot read staging");
});
test("audit can look further back without losing the current environment", async () => {
  const h = harness([
    ["Operations", "Explore deployment history"], ["Choose environment", "Staging"], ["History", "Look further back"],
    ["History", "Home"], ["Operations", "Quit"],
  ]);
  await h.app.run();
  expect(h.calls.filter(o => o.command === "history").map(o => [o.env, o.limit])).toEqual([["staging", 30], ["staging", 60]]);
});
test("audit exports the observation without changing provider state", async () => {
  const h = harness([
    ["Operations", "Explore deployment history"], ["Choose environment", "Production"], ["History", "Export this observation"],
    ["History", "Home"], ["Operations", "Quit"],
  ]);
  await h.app.run(); expect(h.events).toContain("export"); expect(h.calls.some(o => o.yes)).toBe(false);
});
test("session storage round-trips only nonsecret operation fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ops-session-"));
  try {
    const path = join(directory, "ops.json"), store = sessionStore(path);
    expect(await store.load()).toBeUndefined();
    await store.save({ ...saved, token: "secret" } as Operation);
    expect(await store.load()).toEqual(saved);
    expect(await readFile(`${path}.session.json`, "utf8")).not.toContain("secret");
    expect(() => operation({ ...saved, runId: "42; deploy" })).toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
