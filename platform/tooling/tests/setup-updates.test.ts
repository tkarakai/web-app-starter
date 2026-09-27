import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateKeyPairSync, verify } from "node:crypto";
import { request as httpRequest } from "node:http";
import { appJWT, parseApp, repository, storeApp, verifyInstallation, PERMISSIONS, type Api, type Gh, type Repository } from "../setup-updates/github.ts";
import { appManifest, startSetup } from "../setup-updates/server.ts";
import { argumentsFor, installCaller } from "../setup-updates.ts";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 }), pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const app = { id: 123, slug: "fixture-updater", pem };
const repo: Repository = { id: 42, full_name: "owner/app", owner: { login: "owner", type: "User" }, permissions: { admin: true } };
function fixtureAPI(overrides: { selection?: string; count?: number; permissions?: Record<string, string> } = {}) {
  const calls: { method: string; endpoint: string; body?: unknown }[] = [];
  const request: Api = async (method, endpoint, _token, body) => {
    calls.push({ method, endpoint, body });
    if (endpoint.startsWith("/app-manifests/")) return app;
    if (endpoint.endsWith("/installation")) return { app_id: app.id, id: 7, repository_selection: overrides.selection ?? "selected", permissions: overrides.permissions ?? { ...PERMISSIONS, metadata: "read" } };
    if (endpoint.endsWith("/access_tokens")) return { token: "transient-fixture-token" };
    if (endpoint === "/installation/repositories") return { total_count: overrides.count ?? 1, repositories: [{ id: repo.id }] };
    if (method === "DELETE" && endpoint === "/installation/token") return null;
    throw Error("Unexpected API path");
  };
  return { request, calls };
}
test("manifest presets a private App and repository permissions; JWT has a short verifiable lifetime", () => {
  const manifest = appManifest(repo, "http://127.0.0.1:4000", "a".repeat(64));
  assert.equal(manifest.public, false); assert.deepEqual(manifest.default_permissions, PERMISSIONS); assert.deepEqual(manifest.default_events, []);
  assert.equal(manifest.redirect_url, "http://127.0.0.1:4000/callback");
  const parts = appJWT(app, 1000).split("."), payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  assert.deepEqual(payload, { iat: 940, exp: 1540, iss: "123" });
  assert(verify("RSA-SHA256", Buffer.from(parts.slice(0, 2).join(".")), keys.publicKey, Buffer.from(parts[2], "base64url")));
  assert.equal(parseApp(app).id, 123); assert.throws(() => parseApp({ ...app, pem: "private-invalid-fixture" }), error => error instanceof Error && !error.message.includes("private-invalid-fixture"));
  assert.throws(() => repository({ ...repo, permissions: { admin: false } }), /administration/);
  assert.throws(() => argumentsFor(["--fallback", "--replace"]), /does not replace/);
  assert.throws(() => argumentsFor(["--repo", "owner/repo/escape"]), /owner\/repo/);
});
test("installation verification checks selected repository and exact permissions, then revokes its read token", async () => {
  const good = fixtureAPI(); await verifyInstallation(app, repo, good.request);
  assert.deepEqual(good.calls.at(-1), { method: "DELETE", endpoint: "/installation/token", body: undefined });
  const multiple = fixtureAPI({ count: 2 }); await assert.rejects(() => verifyInstallation(app, repo, multiple.request), /Select only/); assert.equal(multiple.calls.at(-1)?.method, "DELETE");
  const all = fixtureAPI({ selection: "all" }); await assert.rejects(() => verifyInstallation(app, repo, all.request), /selected app repository only/); assert.equal(all.calls.length, 1);
  const broad = fixtureAPI({ permissions: { ...PERMISSIONS, administration: "write" } }); await assert.rejects(() => verifyInstallation(app, repo, broad.request), /permissions differ/);
});
test("private key goes only to gh stdin, and partial storage explains the public ID recovery", () => {
  const calls: { args: string[]; input?: string }[] = [];
  const run: Gh = (args, input) => { calls.push({ args, input }); return ""; };
  storeApp(app, repo.full_name, run);
  assert.equal(calls[0].input, pem); assert.equal(calls[1].input, undefined); assert(!JSON.stringify(calls.map(row => row.args)).includes("PRIVATE KEY-----"));
  assert.deepEqual(calls[1].args, ["variable", "set", "PLATFORM_UPDATER_APP_ID", "--repo", repo.full_name, "--body", "123"]);
  assert.throws(() => storeApp(app, repo.full_name, (args) => { if (args[0] === "variable") throw Error("private server message"); return ""; }), error => error instanceof Error && error.message.includes("123") && !error.message.includes("private server message"));
});
test("caller installation preserves custom schedules and refuses symlink traversal", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "setup-updates-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "platform/templates"), { recursive: true }); fs.writeFileSync(path.join(root, "platform/templates/update-platform.yml"), "name: template\n");
  assert.equal(installCaller(root), true); fs.writeFileSync(path.join(root, ".github/workflows/update-platform.yml"), "custom schedule\n"); assert.equal(installCaller(root), false);
  assert.equal(fs.readFileSync(path.join(root, ".github/workflows/update-platform.yml"), "utf8"), "custom schedule\n");
  fs.unlinkSync(path.join(root, ".github/workflows/update-platform.yml")); fs.symlinkSync(path.join(root, "platform/templates/update-platform.yml"), path.join(root, ".github/workflows/update-platform.yml")); assert.throws(() => installCaller(root), /symlink/);
});
test("real loopback handshake rejects bad state, host and replay; it never serves the private key", async () => {
  const api = fixtureAPI(), writes: { args: string[]; input?: string }[] = [];
  const session = await startSetup({ repo, request: api.request, run: (args, input) => { writes.push({ args, input }); return ""; }, timeoutMs: 15_000 });
  const url = new URL(session.url), state = url.searchParams.get("state")!, callback = url.origin + "/callback?state=" + state + "&code=" + "a".repeat(40);
  try {
    const form = await (await fetch(session.url)).text(); assert.match(form, /method="post"/); assert.match(form, /https:\/\/github.com\/settings\/apps\/new/); assert(!form.includes(pem));
    assert.equal((await fetch(url.origin + "/callback?state=wrong&code=" + "a".repeat(40))).status, 403); assert.equal(api.calls.length, 0);
    assert.equal((await fetch(callback, { headers: { Origin: "https://example.invalid" } })).status, 403);
    const badHost = await new Promise<number>(resolve => { const req = httpRequest(session.url, { headers: { Host: "foreign.example" } }, res => { res.resume(); resolve(res.statusCode!); }); req.end(); }); assert.equal(badHost, 403);
    const exchange = await fetch(callback), install = await exchange.text(); assert.equal(exchange.status, 200); assert.match(install, /fixture-updater\/installations\/new/); assert(!install.includes(pem)); assert.equal(writes.length, 0);
    assert.equal((await fetch(callback)).status, 409);
    const finished = await fetch(url.origin + "/installed?state=" + state, { method: "POST", headers: { Origin: url.origin } });
    assert.equal(finished.status, 200); assert(!(await finished.text()).includes(pem)); assert.deepEqual(await session.done, { id: 123, slug: app.slug });
    assert.equal(writes[0].input, pem); assert.equal(writes.length, 2);
  } finally { session.close(); }
});
test("an installation mismatch keeps the helper open without storing credentials; cancellation closes it", async () => {
  const api = fixtureAPI({ count: 2 }), writes: string[][] = [];
  const session = await startSetup({ repo, request: api.request, run: args => { writes.push(args); return ""; }, timeoutMs: 15_000 });
  const url = new URL(session.url), state = url.searchParams.get("state")!;
  await fetch(url.origin + "/callback?state=" + state + "&code=" + "b".repeat(40));
  const response = await fetch(url.origin + "/installed?state=" + state); assert.equal(response.status, 409); assert.match(await response.text(), /Select only owner\/app/); assert.equal(writes.length, 0);
  session.close(); await assert.rejects(session.done, /cancelled/);
});

test("cancellation during GitHub requests never stores credentials after the helper closes", async () => {
  for (const stage of ["registration", "verification"]) {
    const api = fixtureAPI(), writes: string[][] = [];
    let unblock!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const request: Api = async (...args) => {
      if ((stage === "registration" && args[1].startsWith("/app-manifests/")) || (stage === "verification" && args[1] === "/installation/repositories")) { entered(); await gate; }
      return api.request(...args);
    };
    const session = await startSetup({ repo, request, run: args => { writes.push(args); return ""; }, timeoutMs: 15_000 });
    const url = new URL(session.url), state = url.searchParams.get("state")!;
    const callback = url.origin + "/callback?state=" + state + "&code=" + "c".repeat(40);
    if (stage === "verification") await fetch(callback);
    const response = fetch(stage === "registration" ? callback : url.origin + "/installed?state=" + state);
    await waiting; session.close(); await assert.rejects(session.done, /cancelled/); unblock();
    assert.equal((await response).status, 410); assert.equal(writes.length, 0);
    if (stage === "verification") assert.equal(api.calls.at(-1)?.method, "DELETE");
  }
});

test("actual CLI check is read-only; fallback and existing-App runs preserve settings and custom callers", async t => {
  const { spawnSync } = await import("node:child_process"), { fileURLToPath } = await import("node:url");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "setup-cli-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "bin")); fs.mkdirSync(path.join(root, "platform/templates"), { recursive: true });
  fs.writeFileSync(path.join(root, ".platform-base.json"), "{}"); fs.writeFileSync(path.join(root, "platform/templates/update-platform.yml"), "name: update fixture\n");
  const stub = path.join(root, "bin/gh");
  fs.writeFileSync(stub, `#!/usr/bin/env node\nconst a=process.argv.slice(2),existing=process.env.SETUP_EXISTING==='true'; require('fs').appendFileSync(process.env.SETUP_CALLS,JSON.stringify(a)+'\\n'); let value; if(a[0]==='repo')value={nameWithOwner:'owner/app'}; else if(a[0]==='variable'&&a[1]==='list')value=existing?[{name:'PLATFORM_UPDATER_APP_ID',value:'123'}]:[]; else if(a[0]==='secret'&&a[1]==='list')value=existing?[{name:'PLATFORM_UPDATER_PRIVATE_KEY'}]:[]; else if(a[0]==='api')value=a[1].endsWith('/workflow')?{can_approve_pull_request_reviews:false}:${JSON.stringify(repo)}; else throw Error('unexpected mutation'); process.stdout.write(JSON.stringify(value));\n`, { mode: 0o755 });
  const script = fileURLToPath(new URL("../setup-updates.ts", import.meta.url)), log = path.join(root, "calls.jsonl");
  const invoke = (args: string[], existing = false) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", timeout: 10_000, env: { ...process.env, PATH: path.join(root, "bin") + path.delimiter + process.env.PATH, SETUP_CALLS: log, SETUP_EXISTING: String(existing) } });
  const check = invoke(["--check"], true); assert.equal(check.status, 0, check.stderr); assert.equal(JSON.parse(check.stdout).privateKeyPresent, true); assert(!fs.existsSync(path.join(root, ".github")));
  const fallback = invoke(["--fallback"]); assert.equal(fallback.status, 0, fallback.stderr); assert.match(fallback.stdout, /Approve and run/); assert.match(fallback.stdout, /settings\/actions/);
  const caller = path.join(root, ".github/workflows/update-platform.yml"); fs.writeFileSync(caller, "custom schedule\n");
  const existing = invoke([], true); assert.equal(existing.status, 0, existing.stderr); assert.match(existing.stdout, /settings already exist/); assert.equal(fs.readFileSync(caller, "utf8"), "custom schedule\n");
  const refuse = invoke(["--fallback"], true); assert.equal(refuse.status, 1); assert.match(refuse.stderr, /leaves credentials intact/);
  assert(!fs.readFileSync(log, "utf8").split("\n").filter(Boolean).some(line => /"set"|"delete"/.test(line)));
});
