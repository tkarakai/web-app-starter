import { afterAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "bun";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const temp = await mkdtemp(resolve(tmpdir(), "ops-cli-tests-"));
const config = resolve(temp, "ops.json");
const sha = "a".repeat(40);
await writeFile(config, JSON.stringify({ repository: "team/repo", workflowRef: "main", apps: { web: { projects: { staging: { id: "prj_1", domain: "staging.example.com" } } } } }));
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });
async function run(args: string[], mode = "success", useConfig = true, json = true, configPath = config) {
  const proc = spawn([process.execPath, "--preload", resolve(root, "packages/ops/tests/fixture-preload.ts"), resolve(root, "packages/ops/src/cli.ts"), ...args, ...(useConfig ? ["--config", configPath] : ["--repo", "team/repo"]), ...(json ? ["--json"] : [])], {
    cwd: useConfig ? root : temp, env: { ...process.env, GH_TOKEN: "fixture-token", VERCEL_TOKEN: "fixture-vercel", OPS_TEST_MODE: mode }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { lines: json ? stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [], stdout, stderr, exitCode };
}
for (const args of [["status", "--env", "staging"], ["history"], ["builds"], ["candidates"], ["inspect", sha], ["diff", "staging", sha], ["runs", "--active"], ["projects"]]) {
  test(`CLI ${args[0]} emits a clean, versioned JSON result`, async () => {
    const result = await run(args); expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
    expect(result.lines[0]).toMatchObject({ schemaVersion: 1, ok: true, partial: false });
  });
}
test("CLI complete dispatch/watch flow follows the accepted request and sees completion", async () => {
  const result = await run(["deploy", sha, "--to", "staging", "--yes", "--watch", "--interval", "1"]);
  expect(result.exitCode).toBe(0); expect(result.lines[0].data.dispatched).toBe(true);
  expect(result.lines[1].data.status).toBe("in_progress"); expect(result.lines.at(-1).data.conclusion).toBe("success");
});
test("CLI production dry run checks gates and never dispatches", async () => {
  const result = await run(["deploy", sha, "--to", "production", "--dry-run"]);
  expect(result.exitCode).toBe(0); expect(result.lines[0].data.dispatched).toBe(false);
});
test("CLI watch failure returns actionable error and nonzero exit", async () => {
  const result = await run(["watch", "42", "--interval", "1"], "failed");
  expect(result.exitCode).toBe(4); expect(result.lines.at(-1).errors[0].code).toBe("WORKFLOW_FAILED");
  expect(result.stderr).toContain("ops logs 42");
});
test("CLI timeout leaves workflow running and reports how to reconnect", async () => {
  const result = await run(["watch", "42", "--timeout", "1", "--interval", "1"], "timeout");
  expect(result.exitCode).toBe(5); expect(result.lines.at(-1).errors[0].code).toBe("WATCH_TIMEOUT");
});
test("CLI partial results do not look successful to agents", async () => {
  const result = await run(["status"], "partial");
  expect(result.exitCode).toBe(3); expect(result.lines[0]).toMatchObject({ ok: false, partial: true });
  expect(result.stderr).toContain("FORBIDDEN");
});
test("CLI auth errors never expose credentials", async () => {
  const result = await run(["runs"], "forbidden");
  expect(result.exitCode).toBe(1); expect(result.lines[0].errors[0].code).toBe("FORBIDDEN");
  expect(JSON.stringify(result)).not.toContain("fixture-token");
});
test("CLI rejects writes without explicit --yes", async () => {
  const result = await run(["deploy", sha, "--to", "staging"]);
  expect(result.exitCode).toBe(2); expect(result.lines[0].errors[0].code).toBe("CONFIRMATION_REQUIRED");
});
test("default CLI with no config explains setup instead of displaying unconfigured states", async () => {
  const result = await run([], "success", false, false);
  expect(result.exitCode).toBe(3);
  expect(result.stderr).toContain("Configuration missing");
  expect(result.stderr).toContain("ops.config.example.json");
  expect(result.stderr).toContain("VERCEL_TOKEN");
  expect(result.stderr).toContain("bun run ops projects");
  expect(result.stdout).not.toContain("unconfigured");
  expect(result.stdout).not.toContain("Current environments");
  expect(result.stdout).toContain("Active CI and builds");
});
test("missing config produces an actionable JSON error while preserving GitHub results", async () => {
  const result = await run(["status"], "success", false);
  expect(result.exitCode).toBe(3);
  expect(result.lines[0]).toMatchObject({ ok: false, partial: true, data: { rows: [], activity: [] } });
  expect(result.lines[0].errors).toHaveLength(1);
  expect(result.lines[0].errors[0]).toMatchObject({ code: "CONFIG_MISSING", details: { configPath: "ops.config.json" } });
  expect(result.lines[0].errors[0].details.missingProjectMappings).toHaveLength(6);
});
test("partial configuration preserves configured rows and names only the missing mappings", async () => {
  const result = await run(["status"]);
  expect(result.exitCode).toBe(3);
  expect(result.lines[0].data.rows).toHaveLength(1);
  expect(result.lines[0].data.rows[0]).toMatchObject({ environment: "staging", state: "READY" });
  expect(result.lines[0].errors[0].details.missingProjectMappings).toEqual(["web/production"]);
  expect(result.lines[0].errors[0].details.configPath).toBe(config);
});
test("GitHub-only commands still work without Vercel configuration", async () => {
  const result = await run(["runs"], "success", false);
  expect(result.exitCode).toBe(0); expect(result.lines[0].ok).toBe(true);
});

test("auth status is independent of config and reports both credential sources", async () => {
  const result = await run(["auth", "status"], "success", false);
  expect(result.exitCode).toBe(0);
  expect(result.lines[0].data.rows).toMatchObject([
    { provider: "github", source: "GH_TOKEN", account: "github-operator" },
    { provider: "vercel", source: "VERCEL_TOKEN", account: "vercel-operator" },
  ]);
});
test("failed GitHub auth does not hide healthy Vercel auth", async () => {
  const result = await run(["auth", "status"], "github-auth-failed", false);
  expect(result.exitCode).toBe(3);
  expect(result.lines[0]).toMatchObject({ ok: false, partial: true });
  expect(result.lines[0].data.rows[1].state).toBe("authenticated");
});
test("team and project discovery work before GitHub authentication/configuration", async () => {
  for (const args of [["teams"], ["projects", "--team", "my-team"]]) {
    const result = await run(args, "github-auth-failed", false);
    expect(result.exitCode).toBe(0);
    expect(result.lines[0].data.rows).toHaveLength(1);
  }
});
test("unknown team is an actionable failure instead of falling back to a selected team", async () => {
  const result = await run(["projects", "--team", "unavailable"], "success", false);
  expect(result.exitCode).toBe(2);
  expect(result.lines[0].errors[0].code).toBe("TEAM_NOT_FOUND");
});
test("JSON login/setup fail immediately without browser prompts or provider calls", async () => {
  for (const args of [["setup"], ["auth", "login", "github"], ["auth", "login", "vercel"]]) {
    const result = await run(args, "forbidden", false);
    expect(result.exitCode).toBe(2);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].errors[0]).toMatchObject({ code: "INTERACTIVE_REQUIRED" });
    expect(result.stderr).toContain("ops auth status --json");
  }
});
test("doctor checks Vercel access even when GitHub access fails", async () => {
  const result = await run(["doctor"], "github-auth-failed");
  expect(result.exitCode).toBe(3);
  expect(result.lines[0].data.rows).toEqual([{ provider: "github", result: "failed" }, { provider: "vercel", result: "accessible" }]);
});

test("status and doctor succeed for a configured staging project and explicitly skipped production", async () => {
  const path = resolve(temp, "skipped.json");
  await writeFile(path, JSON.stringify({ repository: "team/repo", workflowRef: "main", apps: { web: { projects: { staging: { id: "prj_1", domain: "staging.example.com" }, production: null } } } }));
  for (const command of ["status", "doctor"]) {
    const result = await run([command], "success", true, true, path);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.lines[0]).toMatchObject({ ok: true, partial: false, errors: [] });
    if (command === "status") {
      expect(result.lines[0].data.rows).toHaveLength(1);
      expect(result.lines[0].data.skipped).toMatchObject([{ app: "web", environment: "production" }]);
    } else expect(result.lines[0].data.skippedProjectMappings).toEqual(["web/production"]);
  }
});
