/** Offline Node tests: bun run test:ops. No live accounts or servers. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { main, options } from "./cli.js";
import { loadConfig, ROOT } from "./config.js";
import { candidates, reconcile, safeUrl, utc } from "./evidence.js";
import {
  candidateTable,
  clean,
  coverageText,
  history,
  overview,
  table,
} from "./render.js";
import {
  Collector,
  createGithubGet,
  parallel,
  SourceError,
  tagTime,
  vercelGet,
} from "./sources.js";
import type { Config, Evidence, Ref, Snapshot, TagObject } from "./types.js";

const fixture = JSON.parse(
  readFileSync(
    resolve(ROOT, "scripts/tests/fixtures/ops-evidence.json"),
    "utf8",
  ),
) as Snapshot;
const A = "abcdef0123451111111111111111111111111111";
const B = "abcdef0123452222222222222222222222222222";
const APPS = ["web", "admin", "landing"];
const config = (): Config => ({
  repo: "example/starter",
  apps: [...APPS],
  projects: {},
});
const snapshot = (): Snapshot => globalThis.structuredClone(fixture);
const events = (s: Snapshot = snapshot()): Evidence[] => reconcile(s, APPS);
const find = (id: string, s?: Snapshot): Evidence => {
  const result = events(s).find((e) => e.id === id);
  assert.ok(result, id);
  return result;
};

test("dispatch target is not workflow head; failed untagged target withheld", () => {
  assert.equal(find("run:20").sha, A);
  assert.equal(find("run:20").context_sha, B);
  assert.equal(find("artifact:3").sha, A);
  for (const id of ["run:40", "artifact:4", "github-deployment:502"])
    assert.equal(find(id).sha, null);
});
test("exact deployment URL joins and latest GitHub status preserves chronology", () => {
  const dep = find("github-deployment:501");
  assert.equal(dep.sha, A);
  assert.equal(dep.context_sha, B);
  assert.equal(dep.app, "web");
  assert.equal(dep.state, "inactive");
  assert.equal(dep.time, "2026-09-21T13:03:00.000Z");
  assert.ok(dep.related.includes("vercel:dpl_prod"));
  assert.ok(find("vercel:dpl_prod").related.includes(dep.id));
  assert.equal(find("vercel:dpl_prod").current, true);
});
test("joins require full SHA AND app, not a shared short prefix or input hash", () => {
  assert.equal(A.slice(0, 12), B.slice(0, 12));
  assert.ok(find("vercel:dpl_prod").related.includes("artifact:1"));
  assert.ok(!find("vercel:dpl_prod").related.includes("artifact:2"));
  assert.ok(!find("vercel:dpl_staging").related.includes("artifact:1"));
});
test("resolve job success does not invent a fresh build or accept CI report bundles", () => {
  assert.equal(find("job:201").kind, "build-resolve");
  assert.equal(events().filter((e) => e.kind === "artifact").length, 4);
  assert.ok(!events().some((e) => ["artifact:5", "artifact:6"].includes(e.id)));
});
test("expiry uses both explicit flag and snapshot time", () => {
  assert.equal(find("artifact:1").state, "available");
  assert.equal(find("artifact:2").state, "expired");
  const s = snapshot();
  s.artifacts[0].expired = true;
  assert.equal(find("artifact:1", s).state, "expired");
});
test("missing expiry cannot claim availability", () => {
  const s = snapshot();
  delete s.artifacts[0].expires_at;
  assert.equal(find("artifact:1", s).state, "unknown");
});
test("staging comes from project mapping, not Vercel production target", () => {
  assert.equal(find("vercel:dpl_staging").environment, "staging");
  assert.equal(find("vercel:dpl_prod").environment, "production");
});
test("a newer failed deployment is not assumed serving", () => {
  assert.equal(find("vercel:dpl_failed").sha, null);
  assert.equal(find("vercel:dpl_failed").current, false);
  const text = overview(events(), APPS);
  assert.match(text, /dpl_prod/);
  assert.match(text, /ERROR/);
});
test("conflicting workflow and Vercel metadata is not silently reconciled", () => {
  const s = snapshot();
  s.vercel[1].deployment.meta!.githubCommitSha = B;
  assert.equal(find("github-deployment:501", s).sha, null);
  assert.ok(
    find("vercel:dpl_prod", s).notes.some((n) => n.includes("CONFLICT")),
  );
});
test("conflicting or foreign Vercel metadata withheld", () => {
  const s = snapshot();
  const meta = s.vercel[1].deployment.meta!;
  meta.gitCommitSha = B;
  assert.equal(find("vercel:dpl_prod", s).sha, null);
  delete meta.gitCommitSha;
  meta.githubCommitOrg = "other";
  meta.githubCommitRepo = "repo";
  assert.equal(find("vercel:dpl_prod", s).sha, null);
});
test("stable ordering independent of provider order", () => {
  const s = snapshot();
  const before = events(s).map((e) => e.id);
  for (const key of [
    "runs",
    "artifacts",
    "jobs",
    "tags",
    "deployments",
    "vercel",
  ] as const)
    s[key].reverse();
  assert.deepEqual(
    events(s).map((e) => e.id),
    before,
  );
});
test("CI Build-step success is distinct from failing bundle-size job and deployable upload", () => {
  const s = snapshot();
  s.jobs.push({
    id: 777,
    run_id: 10,
    name: "ci-web / Build & Bundle Size",
    conclusion: "failure",
    steps: [
      {
        name: "Build",
        conclusion: "success",
        started_at: "2026-09-20T11:30:00Z",
        completed_at: "2026-09-20T11:32:00Z",
      },
    ],
  });
  const e = find("ci-build:777", s);
  assert.equal(e.sha, A);
  assert.equal(e.state, "success");
  assert.equal(e.updated_at, "2026-09-20T11:32:00.000Z");
  assert.equal(e.environment, null);
});
test("PR CI checkout is not inferred from head SHA", () => {
  const s = snapshot();
  s.runs.push({
    id: 99,
    path: ".github/workflows/ci-storybook.yml",
    event: "pull_request",
    head_sha: A,
  });
  s.jobs.push({ id: 999, run_id: 99, name: "Build", conclusion: "success" });
  const e = reconcile(s, [...APPS, "storybook"]).find(
    (e) => e.id === "ci-build:999",
  )!;
  assert.equal(e.sha, null);
  assert.equal(e.context_sha, A);
});
test("subsecond timestamps sort chronologically", () => {
  const s = snapshot();
  s.artifacts[0].created_at = "2026-09-20T12:02:00.100Z";
  s.artifacts[1].created_at = "2026-09-20T12:02:00Z";
  const ids = events(s).map((e) => e.id);
  assert.ok(ids.indexOf("artifact:1") < ids.indexOf("artifact:2"));
});
test("UTC parsing is deterministic and invalid timestamps stay unknown", () => {
  assert.equal(utc("2026-09-20T12:00:00"), "2026-09-20T12:00:00.000Z");
  assert.equal(utc("2026-09-20T14:00:00+02:00"), "2026-09-20T12:00:00.000Z");
  assert.equal(utc("invalid"), "");
  assert.equal(utc(null), "");
});
test("source release is not deployment evidence", () => {
  assert.equal(find("tag:v1.2.0").kind, "release-tag");
  assert.equal(find("tag:v1.2.0").environment, null);
});
test("candidates require current gates, not artifacts or successful workflow", () => {
  const rows = candidates(fixture, events(), APPS, 10);
  const a = rows.find((r) => r.sha === A)!;
  const b = rows.find((r) => r.sha === B)!;
  assert.equal(a.classification, "gates-pass");
  assert.equal(b.classification, "blocked");
  assert.equal(a.artifacts.admin[0].state, "expired");
  assert.deepEqual(b.artifacts.web, []);
  assert.deepEqual(a.release_tags, ["v1.2.0"]);
  assert.match(a.limitations[0], /Gates only/);
});
test("missing staging tag or current status does not establish eligibility", () => {
  const s = snapshot();
  s.tags = [];
  assert.equal(
    candidates(s, events(s), APPS, 10, A)[0].classification,
    "insufficient-evidence",
  );
  s.gates = {};
  assert.equal(
    candidates(s, events(s), APPS, 10, A)[0].classification,
    "insufficient-evidence",
  );
});
test("GitHub evidence remains useful without Vercel", () => {
  const s = snapshot();
  s.vercel = [];
  assert.equal(find("github-deployment:501", s).sha, A);
  assert.equal(find("github-deployment:501", s).current, null);
  assert.equal(find("artifact:1", s).sha, A);
});
test("full collector accepts provider-shaped fixture and deduplicates artifacts", async () => {
  const s = snapshot();
  const refs: Ref[] = [];
  const tags: Record<string, TagObject> = {};
  s.tags.forEach((tag, i) => {
    const oid = String(i + 1).repeat(40);
    refs.push({
      ref: `refs/tags/${tag.name}`,
      object: { type: "tag", sha: oid },
    });
    tags[oid] = {
      object: { type: "commit", sha: tag.sha },
      message: `Workflow run: https://github.com/example/starter/actions/runs/${tag.run_id}`,
    };
  });
  const collector = new Collector(config(), 10, 3, async (path) => {
    const [resource, query = ""] = path
      .replace("repos/example/starter/", "")
      .split("?");
    const parts = resource.split("/");
    if (resource.startsWith("git/matching-refs/tags/"))
      return refs.filter((r) =>
        r.ref.startsWith(
          `refs/tags/${resource.replace("git/matching-refs/tags/", "")}`,
        ),
      );
    if (resource.startsWith("git/tags/")) return tags[parts.at(-1)!];
    if (resource.startsWith("actions/workflows/")) {
      const workflow_runs = s.runs.filter((r) =>
        r.path?.endsWith(`/${parts[2]}`),
      );
      return { workflow_runs, total_count: workflow_runs.length };
    }
    if (resource.startsWith("actions/runs/")) {
      const id = Number(parts[2]);
      if (resource.endsWith("/jobs")) {
        const jobs = s.jobs.filter((j) => j.run_id === id);
        return { jobs, total_count: jobs.length };
      }
      if (resource.endsWith("/artifacts")) {
        const artifacts = s.artifacts.filter((a) => a.workflow_run?.id === id);
        return { artifacts, total_count: artifacts.length };
      }
      return s.runs.find((r) => r.id === id);
    }
    if (resource === "actions/artifacts")
      return { artifacts: s.artifacts, total_count: s.artifacts.length };
    if (resource === "deployments")
      return query.includes("environment=production") ? s.deployments : [];
    if (resource.startsWith("deployments/"))
      return s.deployments.find((d) => String(d.id) === parts[1])!.statuses;
    if (resource.startsWith("commits/"))
      return {
        statuses: [{ context: "ci/gate-passed", ...s.gates[parts[1]] }],
        total_count: 1,
      };
    assert.fail(`Unexpected endpoint: ${path}`);
  });
  const result = await collector.collect(undefined, true);
  assert.equal(result.artifacts.length, 6);
  assert.equal(find("artifact:3", result).sha, A);
  assert.equal(
    candidates(result, events(result), APPS, 10, A)[0].classification,
    "gates-pass",
  );
});
test("pagination is bounded and reports window", async () => {
  const paths: string[] = [];
  const collector = new Collector(config(), 10, 2, async (path) => {
    paths.push(path);
    return { items: [{ id: paths.length }], total_count: 4 };
  });
  assert.deepEqual(
    await collector.listing("actions/artifacts", "artifacts", "items", 1),
    [{ id: 1 }, { id: 2 }],
  );
  assert.match(paths[1], /per_page=1&page=2$/);
  assert.equal(collector.coverage.at(-1)!.state, "windowed");
});
test("partial failure preserves previous page", async () => {
  const collector = new Collector(config(), 10, 3, async (path) => {
    if (path.includes("page=2")) throw new SourceError("rate limited");
    return [1];
  });
  assert.deepEqual(await collector.listing("test", "test", undefined, 1), [1]);
  assert.equal(collector.coverage.at(-1)!.state, "unavailable");
});
test("repeated pages stop with partial coverage", async () => {
  const collector = new Collector(config(), 10, 3, async () => [1]);
  assert.deepEqual(await collector.listing("test", "test", undefined, 1), [1]);
  assert.equal(collector.coverage.at(-1)!.state, "partial");
});
test("annotated tag uses resolved commit, not tag object SHA", async () => {
  const ref = {
    ref: `refs/tags/deploy/staging/2026-09-20T12-05-00Z/${A}`,
    object: { type: "tag", sha: B },
  };
  const collector = new Collector(config(), 10, 3, async (path) =>
    path.includes("matching-refs")
      ? [ref]
      : {
          object: { type: "commit", sha: A },
          message:
            "Workflow run: https://github.com/example/starter/actions/runs/10",
        },
  );
  const tag = (await collector.tags("deploy/"))[0];
  assert.equal(tag.sha, A);
  assert.equal(tag.run_id, 10);
  assert.equal(tag.time, "2026-09-20T12:05:00Z");
});
test("tag window preserves older production when staging is busier", async () => {
  const refs = [1, 2, 3, 4].map((i) => ({
    ref: `refs/tags/deploy/staging/2026-09-2${i}T12-05-00Z/${A}`,
    object: { type: "commit", sha: A },
  }));
  refs.push({
    ref: `refs/tags/deploy/production/2026-09-01T12-05-00Z/${A}`,
    object: { type: "commit", sha: A },
  });
  const collector = new Collector(config(), 1, 3, async () => refs);
  const tags = await collector.tags("deploy/");
  assert.equal(tags.length, 2);
  assert.ok(tags.some((t) => t.name.startsWith("deploy/production/")));
  assert.equal(collector.coverage.at(-1)!.state, "windowed");
});
test("misnamed deployment tag rejected", async () => {
  const collector = new Collector(config(), 10, 3, async () => [
    {
      ref: `refs/tags/deploy/staging/2026-09-20T12-05-00Z/${A}`,
      object: { type: "commit", sha: B },
    },
  ]);
  assert.deepEqual(await collector.tags("deploy/"), []);
  assert.equal(collector.coverage.at(-1)!.state, "partial");
});
test("rollback tag timestamp parsed", () =>
  assert.equal(
    tagTime(`refs/tags/deploy/staging/rollback/2026-09-20T12-05-00Z/${A}`),
    "2026-09-20T12:05:00Z",
  ));
test("Vercel cursor, team scope and older serving target retained", async () => {
  const paths: string[] = [];
  const collector = new Collector(
    {
      ...config(),
      apps: ["web"],
      projects: { web: { staging: "prj_stage" } },
      team_id: "team_test",
    },
    10,
    3,
    undefined,
    async (path) => {
      paths.push(path);
      if (path.includes("/projects/"))
        return {
          targets: {
            production: { id: "dpl_old", createdAt: 1, url: "old.vercel.app" },
          },
        };
      return path.includes("until=")
        ? { deployments: [], pagination: { next: null } }
        : {
            deployments: [{ uid: "dpl_new", state: "ERROR" }],
            pagination: { next: 10 },
          };
    },
  );
  const rows = await collector.collectVercel(false);
  assert.ok(
    paths.some((p) => p.includes("until=10") && p.includes("teamId=team_test")),
  );
  assert.equal(rows[0].current, false);
  assert.equal(rows[1].current, true);
  assert.equal(rows[1].deployment.uid, "dpl_old");
});
test("project current survives failed listing without double-prefixing URL", async () => {
  const collector = new Collector(
    {
      ...config(),
      apps: ["web"],
      projects: { web: { production: "prj_prod" } },
    },
    10,
    3,
    undefined,
    async (path) => {
      if (path.includes("/projects/"))
        return {
          targets: {
            production: { id: "dpl_old", url: "https://old.vercel.app" },
          },
        };
      throw new SourceError("rate limited");
    },
  );
  const rows = await collector.collectVercel(false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].current, true);
  const s = snapshot();
  s.vercel = rows;
  assert.equal(find("vercel:dpl_old", s).url, "https://old.vercel.app");
});
test("Vercel missing token is visible, and authenticated transport is GET-only", async (t) => {
  const token = process.env.VERCEL_TOKEN;
  delete process.env.VERCEL_TOKEN;
  t.after(() => {
    if (token === undefined) delete process.env.VERCEL_TOKEN;
    else process.env.VERCEL_TOKEN = token;
  });
  await assert.rejects(vercelGet("/v7/deployments"), /VERCEL_TOKEN not set/);
  process.env.VERCEL_TOKEN = "do-not-print";
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      assert.equal(url, "https://api.vercel.com/v7/deployments");
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      return new Response(JSON.stringify({ deployments: [] }), { status: 200 });
    },
  );
  assert.deepEqual(await vercelGet("/v7/deployments"), { deployments: [] });
});
test("GitHub subprocess gets only GET arguments and suppresses sensitive errors", async () => {
  const read = createGithubGet(async (file, args) => {
    assert.equal(file, "gh");
    assert.deepEqual(args, ["api", "--method", "GET", "repos/example/starter"]);
    return '{"ok":true}';
  });
  assert.deepEqual(await read("repos/example/starter"), { ok: true });
  const fail = createGithubGet(async () => {
    throw new Error("TOKEN-secret");
  });
  await assert.rejects(
    fail("repos/example/starter"),
    (e) => e instanceof SourceError && !e.message.includes("TOKEN-secret"),
  );
});
test("GitHub outage does not prevent Vercel collection", async () => {
  const collector = new Collector(config(), 1, 1, async () => {
    throw new SourceError("offline");
  });
  collector.collectVercel = async () => fixture.vercel;
  const s = await collector.collect();
  assert.equal(s.vercel.length, 3);
  assert.ok(s.coverage.some((c) => c.state === "unavailable"));
});
test("collector concurrency is bounded at six and result ordering stable", async () => {
  let active = 0;
  let max = 0;
  const rows = await parallel(
    Array.from({ length: 20 }, (_, i) => i),
    async (i) => {
      active++;
      max = Math.max(max, active);
      await Promise.resolve();
      active--;
      return i;
    },
  );
  assert.ok(max <= 6);
  assert.deepEqual(
    rows,
    Array.from({ length: 20 }, (_, i) => i),
  );
});
test("deterministic table golden and empty state", () => {
  assert.equal(
    table(
      ["APP", "STATE"],
      [
        ["web", "READY"],
        ["admin", "ERROR"],
      ],
    ),
    "APP    STATE\n-----  -----\nweb    READY\nadmin  ERROR",
  );
  assert.match(table(["APP"], []), /no evidence/);
});
test("terminal controls and sensitive URL components removed", () => {
  assert.equal(clean("\u001b[31mERROR\u001b[0m\nnext\u202e"), "ERROR next");
  assert.equal(
    safeUrl("https://example.com/path?token=secret#secret"),
    "https://example.com/path",
  );
  assert.equal(safeUrl("https://user:secret@example.com"), "");
  assert.equal(safeUrl("https://["), "");
});
test("history and candidate tables expose links and evidence limits", () => {
  assert.match(history(events(), 10), /Prebuilt uploads \(not deployments\)/);
  assert.ok(
    history(events(), 10).includes(
      "https://github.com/example/starter/actions/runs/10/artifacts/1",
    ),
  );
  const text = candidateTable(candidates(fixture, events(), APPS, 10));
  for (const value of [
    A,
    "gates-pass",
    "Not approval",
    "no same-checkout upload observed",
  ])
    assert.ok(text.includes(value));
  assert.match(coverageText([]), /Not a complete audit/);
});
test("CLI rejects mutations, short SHAs and invalid bounds", () => {
  for (const args of [
    ["deploy"],
    ["history", "--sha", A.slice(0, 12)],
    ["--pages", "0"],
    ["--limit", "101"],
    ["--unknown"],
  ])
    assert.throws(() => options(args));
});
test("JSON partial result has full-SHA/app filter and exit code 2", async () => {
  const s = snapshot();
  s.coverage.push({
    source: "Vercel",
    state: "unavailable",
    detail: "offline",
  });
  let out = "";
  const code = await main(["history", "--json", "--sha", A, "--app", "web"], {
    config,
    collect: async () => s,
    stdout: (text) => {
      out += text;
    },
  });
  const report = JSON.parse(out) as {
    schema_version: number;
    events: Evidence[];
  };
  assert.equal(code, 2);
  assert.equal(report.schema_version, 1);
  assert.ok(
    report.events.every(
      (e) => e.sha === A && (e.app === null || e.app === "web"),
    ),
  );
  assert.ok(!out.includes('"meta"'));
});
test("conflicting evidence is visible in default output with partial exit", async () => {
  const s = snapshot();
  s.vercel[1].deployment.meta!.githubCommitSha = B;
  let out = "";
  const code = await main([], {
    config,
    collect: async () => s,
    stdout: (text) => {
      out += text;
    },
  });
  assert.equal(code, 2);
  assert.match(out, /CONFLICT/);
  assert.match(out, /partial/);
});
test("configuration respects existing repository and project env names", () => {
  const result = loadConfig(undefined, undefined, {
    GH_REPO: "example/starter",
    VERCEL_ORG_ID: "team_test",
    VERCEL_PROJECT_ID_WEB_STAGING: "prj_stage",
  });
  assert.equal(result.repo, "example/starter");
  assert.equal(result.projects.web.staging, "prj_stage");
  assert.ok(result.apps.includes("landing-static"));
});
test("configuration refuses credentials without echoing values", (t) => {
  mkdirSync(resolve(ROOT, ".ci-local-artifacts"), { recursive: true });
  const dir = mkdtempSync(resolve(ROOT, ".ci-local-artifacts/ops-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const file = resolve(dir, "config.json");
  writeFileSync(file, '{"token":"do-not-print"}');
  assert.throws(
    () => loadConfig(file, "example/starter", {}),
    (e) => e instanceof Error && !e.message.includes("do-not-print"),
  );
});
test("duplicate Vercel project mapping rejected", () => {
  assert.throws(
    () =>
      loadConfig(undefined, "example/starter", {
        VERCEL_PROJECT_ID_WEB_STAGING: "prj_same",
        VERCEL_PROJECT_ID_WEB: "prj_same",
      }),
    /only one/,
  );
});
test("help and argument errors do not contact providers", async () => {
  const collect = async (): Promise<Snapshot> => {
    assert.fail("No network expected");
  };
  let out = "";
  assert.equal(
    await main(["--help"], {
      collect,
      stdout: (text) => {
        out = text;
      },
    }),
    0,
  );
  assert.match(out, /Usage:/);
  assert.equal(await main(["deploy"], { collect, stderr: () => undefined }), 2);
});
