import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectConfig } from "../src/config-repair";
import { loadConfig, validateConfig } from "../src/config";
import { chooseDomain, configureProjects, offerSetup, type SetupUI } from "../src/setup";
import { parseOptions } from "../src/options";

const healthy = { repository: "team/repo", workflowRef: "release", teamId: "team_1", apps: {
  web: { projects: { staging: { id: "prj_web", domain: "web.example.com" }, production: null } },
  admin: { projects: { staging: { id: "prj_admin", domain: null }, production: null } },
} };
test("complete config preserves explicit skips and all-domain choices without repair prompts", () => {
  const result = inspectConfig(JSON.stringify(healthy));
  expect(result.issues).toEqual([]);
  expect(result.draft).toEqual(healthy);
  expect(validateConfig(result.draft)).toEqual(healthy);
});
test("repair salvages valid siblings, IDs and repository settings while identifying each defect", () => {
  const result = inspectConfig(JSON.stringify({ ...healthy, apps: {
    ...healthy.apps, admin: { projects: { staging: { id: "prj_admin", domain: "https://admin.example.com/path" }, production: { id: 42 } } },
  } }));
  expect(result.draft.repository).toBe("team/repo");
  expect(result.draft.workflowRef).toBe("release");
  expect(result.draft.teamId).toBe("team_1");
  expect(result.draft.apps.web).toEqual(healthy.apps.web);
  expect(result.draft.apps.admin.projects.staging).toEqual({ id: "prj_admin" });
  expect(result.draft.apps.admin.projects.production).toBeUndefined();
  expect(result.issues).toHaveLength(2);
  expect(result.issues[0]).toContain("admin/staging: invalid hostname");
  expect(result.issues[1]).toContain("admin/production");
});
test("an omitted hostname triggers repair, but explicit all-domain tracking does not", () => {
  const omitted = { ...healthy, apps: { web: { projects: { staging: { id: "prj_web" }, production: null } } } };
  expect(inspectConfig(JSON.stringify(omitted)).issues).toEqual(["web/staging: no hostname chosen; choose a hostname or explicitly track all domains."]);
});
test("unparseable JSON offers rebuilding without exposing raw contents or guessing values", () => {
  const result = inspectConfig('{"repository": "team/repo", "token": "private-contents",');
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0]).toContain("cannot be recovered reliably");
  expect(JSON.stringify(result)).not.toContain("private-contents");
  expect(result.draft.repository).toBe("");
});
test("invalid containers and names yield safe drafts instead of crashing repair", () => {
  for (const value of [null, [], 3, { apps: [] }, { apps: { "bad/name": null } }, { apps: { web: { projects: [] } } }]) {
    const result = inspectConfig(JSON.stringify(value));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(Object.keys(result.draft.apps).length).toBeGreaterThan(0);
  }
});
test("credential fields and unknown fields never enter the recovered config", () => {
  const result = inspectConfig(JSON.stringify({ ...healthy, VERCEL_TOKEN: "do-not-copy", extra: { token: "nor-this" } }));
  expect(result.draft).toEqual(healthy);
  expect(result.issues).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain("do-not-copy");
  expect(JSON.stringify(result)).not.toContain("nor-this");
});
test("repaired project and domain menus retain all valid choices as defaults", async () => {
  const draft = inspectConfig(JSON.stringify(healthy)).draft;
  const defaults: number[] = [];
  const result = await configureProjects(draft, [{ id: "team_1", name: "Team", slug: "team" }], async () => [{ id: "prj_admin", name: "admin" }, { id: "prj_web", name: "web" }],
    async () => { throw new Error("All choices should use menus"); }, () => {}, undefined,
    async id => [{ alias: id === "prj_web" ? "web.example.com" : "admin.example.com", deploymentId: "d1" }],
    async (_label, _choices, initial) => { expect(initial).toBeDefined(); defaults.push(initial!); return initial!; });
  expect(result).toEqual(healthy);
  expect(defaults).toEqual([0, 1, 0, 2, 0, 2, 2]);
});
test("all-domain selection is offered as the default on the next setup", async () => {
  expect(await chooseDomain("web", [{ alias: "web.example.com", deploymentId: "d1" }], null, async () => "", () => {})).toBeNull();
});
test("existing bad files offer repair; declining, cancelling and headless reads preserve bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ops-repair-"));
  const path = join(dir, "ops.json");
  const original = JSON.stringify({ ...healthy, workflowRef: 123 });
  await writeFile(path, original);
  const messages: string[] = [];
  const questions: string[] = [];
  const ui: SetupUI = { interactive: () => true, tell: text => messages.push(text), ask: async question => { questions.push(question); return "n"; } };
  const options = parseOptions(["status", "--config", path]);
  try {
    expect(await offerSetup(options, () => {}, ui, async () => { throw new Error("Declined repair must not run"); })).toBe(true);
    expect(messages.join("\n")).toContain("workflowRef");
    expect(questions[0]).toContain("Run guided repair");
    expect(await offerSetup(options, () => {}, { ...ui, ask: async () => "y" }, async () => ({ saved: false }))).toBe(false);
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await offerSetup({ ...options, json: true }, () => {}, { ...ui, ask: async () => { throw new Error("No prompts in JSON"); } })).toBe(true);
    await expect(loadConfig(path)).rejects.toMatchObject({ code: "CONFIG_INVALID", hint: expect.stringContaining("ops setup") });
    expect(await readFile(path, "utf8")).toBe(original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
