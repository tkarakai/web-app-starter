import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpApi } from "../src/api";
import { authStatus, runCaptured, vercelSessionFetcher, type Runner } from "../src/auth";
import { validateConfig } from "../src/config";
import { errorInfo, OpsError } from "../src/errors";
import { parseOptions } from "../src/options";
import { chooseDomain, configureProjects, offerSetup, saveConfig, type SetupUI } from "../src/setup";
import type { Config } from "../src/types";

function http(data: unknown, status = 200, headers = "") {
  return { stdout: `HTTP ${status} Response\ncontent-type: application/json\n${headers}\n${JSON.stringify(data)}`, stderr: "Vercel CLI 50.14.1 | api is in beta\n", exitCode: status >= 400 ? 1 : 0 };
}
test("Vercel session pins configured scope on every page without passing credentials", async () => {
  const calls: string[][] = [];
  const run: Runner = async (file, args) => {
    expect(file).toBe("vercel"); calls.push(args);
    return http(calls.length === 1 ? { projects: [{ id: "prj_1" }], pagination: { next: 123 } } : { projects: [{ id: "prj_2" }], pagination: { next: null } });
  };
  const api = new HttpApi("vercel", "", undefined, vercelSessionFetcher(run));
  expect(await api.pages("/v9/projects?teamId=team_chosen", "projects")).toHaveLength(2);
  for (const args of calls) {
    expect(args).toContain("--non-interactive");
    expect(args.slice(-2)).toEqual(["--scope", "team_chosen"]);
    expect(args).not.toContain("--token");
  }
  expect(calls[1][1]).toContain("until=123");
});
test("unscoped session queries fail with setup guidance instead of inheriting a CLI team", async () => {
  const fetcher = vercelSessionFetcher(async () => { throw new Error("must not spawn"); });
  await expect(fetcher("https://api.vercel.com/v9/projects")).rejects.toMatchObject({ code: "CONFIG_MISSING", details: { missing: "teamId" } });
});
test("session HTTP errors preserve status and request IDs even with nonzero CLI exit", async () => {
  const api = new HttpApi("vercel", "", undefined, vercelSessionFetcher(async () => http({ error: { message: "Access denied" } }, 403, "x-vercel-id: trace-1\n")));
  try { await api.get("/v2/teams"); throw new Error("Expected failure"); }
  catch (error) { expect(errorInfo(error)).toMatchObject({ code: "FORBIDDEN", details: { provider: "vercel", status: 403, requestId: "trace-1" } }); }
});
test("session failures without HTTP output retain diagnostics and never retry as network errors", async () => {
  for (const [stderr, code] of [["Error: No existing credentials found. Run vercel login", "AUTH"], ["Error: unknown option --include", "CLI_UNSUPPORTED"], ["Error: The specified scope does not exist", "CLI_COMMAND"]]) {
    let calls = 0;
    const api = new HttpApi("vercel", "", undefined, vercelSessionFetcher(async () => { calls++; return { stdout: "", stderr, exitCode: 1 }; }));
    try { await api.get("/v2/teams"); throw new Error("Expected failure"); }
    catch (error) { expect(errorInfo(error)).toMatchObject({ code, details: { stderr, exitCode: 1 } }); }
    expect(calls).toBe(1);
  }
});
test("malformed session output and nonzero exit with HTTP success are not accepted", async () => {
  for (const result of [{ stdout: "{}", stderr: "", exitCode: 0 }, { ...http({}), exitCode: 1, stderr: "post-request failure" }]) {
    const api = new HttpApi("vercel", "", undefined, vercelSessionFetcher(async () => result));
    await expect(api.get("/v2/teams")).rejects.toBeInstanceOf(OpsError);
  }
});
test("session transport refuses writes and foreign URLs before spawning a process", async () => {
  const fetcher = vercelSessionFetcher(async () => { throw new Error("must not spawn"); });
  await expect(fetcher("https://evil.invalid/v2/user")).rejects.toMatchObject({ code: "INVALID_URL" });
  await expect(fetcher("https://api.vercel.com/v2/user", { method: "POST" })).rejects.toMatchObject({ code: "INVALID_URL" });
});
test("missing native CLI reports installation instructions", async () => {
  await expect(runCaptured("ops-definitely-not-installed", [])).rejects.toMatchObject({ code: "CLI_MISSING" });
});
test("auth status reports the healthy provider when the other fails", async () => {
  const result = await authStatus(undefined, async provider => {
    if (provider === "github") throw new OpsError("AUTH", "Expired GitHub session", "Run ops auth login github");
    return { provider, account: "operator", state: "authenticated" };
  });
  expect(result.errors).toHaveLength(1);
  expect(result.data.rows).toMatchObject([{ provider: "github", state: "failed" }, { provider: "vercel", state: "authenticated" }]);
});
test("credentials are rejected in config, with their values redacted from errors", () => {
  const config = { repository: "team/repo", workflowRef: "main", apps: { web: { projects: {} } } };
  for (const key of ["token", "vercelToken", "VERCEL_TOKEN", "github_token", "accessToken"]) {
    expect(() => validateConfig({ ...config, [key]: "private-credential" })).toThrow("not allowed");
  }
});
test("auth grammar and scoped discovery remain explicit", () => {
  expect(parseOptions(["auth", "login", "vercel"]).args).toEqual(["login", "vercel"]);
  expect(parseOptions(["projects", "--team", "my-team"]).team).toBe("my-team");
  for (const args of [["auth"], ["auth", "login"], ["auth", "login", "other"], ["status", "--team", "team_x"]]) expect(() => parseOptions(args)).toThrow();
});
const teamList = [{ id: "team_a", name: "A", slug: "a" }, { id: "team_b", name: "B", slug: "b" }];
const config: Config = { repository: "team/repo", workflowRef: "main", teamId: "team_a", apps: { web: { projects: { staging: { id: "prj_a", domain: "stage.example.com" } } } } };
function answers(values: string[]) {
  return async () => { const answer = values.shift(); if (answer === undefined) throw new Error("Unexpected prompt"); return answer; };
}
test("wizard retains valid mappings and domains only after explicit user selection", async () => {
  const result = await configureProjects(config, teamList, async id => { expect(id).toBe("team_a"); return [{ id: "prj_a", name: "stage" }]; }, answers(["", "", "", "2"]), () => {});
  expect(result.apps.web.projects.staging).toEqual(config.apps.web.projects.staging);
  expect(result.apps.web.projects.production).toBeNull();
});
test("wizard does not carry mappings or domains across accounts and permits explicit skips", async () => {
  const result = await configureProjects(config, teamList, async () => [{ id: "prj_a", name: "different-project" }], answers(["2", "1", "", "2"]), () => {});
  expect(result.teamId).toBe("team_b");
  expect(result.apps.web.projects.staging).toEqual({ id: "prj_a", domain: null });
  expect(result.apps.web.projects.production).toBeNull();
  expect(config.apps.web.projects.staging?.domain).toBe("stage.example.com");
});
test("saving setup is atomic and refuses to clobber a configuration changed during prompts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ops-setup-tests-"));
  const path = join(dir, "ops.json");
  try {
    await saveConfig(path, config, undefined);
    const original = await readFile(path, "utf8");
    expect(JSON.parse(original)).toEqual(config);
    await writeFile(path, "changed by another process");
    await expect(saveConfig(path, config, original)).rejects.toMatchObject({ code: "CONFIG_CHANGED" });
    expect(await readFile(path, "utf8")).toBe("changed by another process");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const decision of ["yes", "no", "cancel"] as const) {
  test(`missing configuration offers setup before continuing: ${decision}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "ops-onboarding-tests-"));
    const path = join(dir, "custom.json");
    const messages: string[] = [];
    const questions: string[] = [];
    let setups = 0;
    const ui: SetupUI = {
      interactive: () => true,
      tell: text => messages.push(text),
      ask: async question => { questions.push(question); return decision === "no" ? "n" : ""; },
    };
    try {
      const options = parseOptions(["status", "--config", path]);
      const proceed = await offerSetup(options, () => {}, ui, async received => {
        setups++;
        expect(received).toBe(options);
        if (decision === "yes") await saveConfig(path, config, undefined);
        return { saved: decision === "yes" };
      });
      expect(questions).toHaveLength(1);
      expect(questions[0]).toContain("continue with ops status");
      expect(messages[0]).toContain(path);
      expect(setups).toBe(decision === "no" ? 0 : 1);
      expect(proceed).toBe(decision !== "cancel");
      if (decision === "yes") expect(JSON.parse(await readFile(path, "utf8"))).toEqual(config);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
test("GitHub investigation and discovery do not prompt for unrelated project setup", async () => {
  for (const args of [["diagnose", "42"], ["history"], ["logs", "42"], ["teams"], ["auth", "status"], ["watch", "42"]]) {
    const ui: SetupUI = { interactive: () => true, tell: () => { throw new Error("Unexpected setup prompt"); }, ask: async () => { throw new Error("Unexpected setup question"); } };
    expect(await offerSetup(parseOptions(args), () => {}, ui)).toBe(true);
  }
});
test("existing configs, help, explicit setup, JSON and noninteractive commands never offer setup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ops-onboarding-tests-"));
  const path = join(dir, "existing.json");
  await writeFile(path, JSON.stringify({ ...config, apps: { web: { projects: { ...config.apps.web.projects, production: null } } } }));
  const ui: SetupUI = {
    interactive: () => true,
    tell: () => { throw new Error("unexpected setup output"); },
    ask: async () => { throw new Error("unexpected setup prompt"); },
  };
  try {
    for (const args of [["runs", "--config", path], ["help"], ["setup"], ["runs", "--json"]]) {
      expect(await offerSetup(parseOptions(args), () => {}, ui)).toBe(true);
    }
    expect(await offerSetup(parseOptions(["runs"]), () => {}, { ...ui, interactive: () => false })).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("project mapping questions identify both the app and environment before the choices", async () => {
  const displayed: string[] = [];
  await configureProjects(config, teamList, async () => [{ id: "prj_a", name: "stage" }], answers(["", "", "", "2"]), line => displayed.push(line));
  const staging = displayed.findIndex(line => line.includes('Which Vercel project hosts the "web" app in STAGING?'));
  const production = displayed.findIndex(line => line.includes('Which Vercel project hosts the "web" app in PRODUCTION?'));
  expect(staging).toBeGreaterThan(0);
  expect(displayed[staging]).toContain("[1/2]");
  expect(displayed[staging + 1]).toContain("1. stage");
  expect(displayed[production]).toContain("[2/2]");
  expect(displayed).toContain("Selected: web in staging → stage.");
  expect(displayed.some(line => line.includes("Skipped web in production"))).toBe(true);
});

test("domain selection shows actual aliases and preserves the selected hostname", async () => {
  const messages: string[] = [];
  const domain = await chooseDomain('the "web" app in STAGING', [
    { alias: "old.vercel.app", deploymentId: "old" },
    { alias: "web.example.com", deploymentId: "current" },
    { alias: "web.example.com", deploymentId: "current" },
  ], undefined, answers(["1"]), text => messages.push(text));
  expect(domain).toBe("web.example.com");
  expect(messages[0]).toContain('Which hostname should ops track for the "web" app in STAGING?');
  expect(messages.slice(1)).toEqual([
    "  1. web.example.com",
    "  2. old.vercel.app",
    "  3. Enter another hostname",
    "  4. Track all domains (different deployments will be reported as domains-diverge)",
  ]);
});
test("tracking all aliases remains an explicit choice and existing hostnames are defaults", async () => {
  const aliases = [{ alias: "web.example.com", deploymentId: "d1" }, { alias: "old.vercel.app", deploymentId: "d2" }];
  expect(await chooseDomain("web", aliases, "old.vercel.app", answers([""]), () => {})).toBe("old.vercel.app");
  expect(await chooseDomain("web", aliases, undefined, answers(["4"]), () => {})).toBeNull();
});
test("alias discovery failures stop setup instead of silently omitting the domain", async () => {
  await expect(configureProjects(config, teamList, async () => [{ id: "prj_a", name: "stage" }], answers(["", ""]), () => {}, undefined,
    async () => { throw new OpsError("FORBIDDEN", "Cannot read aliases", "Check permissions"); })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
test("explicit skips survive setup validation and are offered as defaults on rerun", async () => {
  const skipped = { ...config, apps: { web: { projects: { staging: null, production: null } } } };
  expect(validateConfig(skipped)).toEqual(skipped);
  const result = await configureProjects(skipped, teamList, async () => [{ id: "prj_a", name: "stage" }], answers(["", "", ""]), () => {});
  expect(result).toEqual(skipped);
  expect(() => validateConfig({ ...skipped, apps: { web: { projects: { invalid: null } } } })).toThrow();
});
