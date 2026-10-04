import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { migrate } from "../codemods/v4-local-fixture-clients.ts";

const legacy = `import * as fs from "node:fs";
import * as path from "node:path";
function getEnvValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  for (const envPath of [
    path.join(__dirname, "../../../.env.local"),
  ]) { if (fs.existsSync(envPath)) return undefined; }
}
function convexSiteUrl() {
  const url = getEnvValue("CONVEX_SITE_URL")!;
  return url.replace(/\\/$/, "");
}
export async function createDisposableUser() {
  const response = await fetch(\u0060\u0024{convexSiteUrl()}/api/dev/e2e-user\u0060, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "e2e-fixture@e2e.local" }),
  });
  return response.json();
}
`;
test("migration is read-only in check mode and migrated client sends only local capabilities without redirects", t => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "v4-client-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relative = "apps/web/qa/e2e/helpers/fixtures.ts", file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, legacy);
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  assert.deepEqual(migrate(root, true), [relative]); assert.equal(fs.readFileSync(file, "utf8"), legacy);
  assert.deepEqual(migrate(root), [relative]); const changed = fs.readFileSync(file, "utf8");
  assert.deepEqual(migrate(root), []); assert.deepEqual(migrate(root, true), []); assert.equal(fs.readFileSync(file, "utf8"), changed);
  const execute = (url: string, secret: string) => spawnSync(process.execPath, ["--input-type=module", "-e", `globalThis.__dirname=${JSON.stringify(path.dirname(file))}; globalThis.fetch=async(url,opts)=>{console.log(JSON.stringify({url,...opts}));return Response.json({success:true})}; const m=await import(${JSON.stringify(pathToFileURL(file).href)}); await m.createDisposableUser();`], { env: { ...process.env, CONVEX_SITE_URL: url, DEV_FIXTURE_SECRET: secret }, encoding: "utf8" });
  const secret = "a".repeat(64), ok = execute("http://127.0.0.1:3211/", secret);
  assert.equal(ok.status, 0, ok.stderr); const request = JSON.parse(ok.stdout);
  assert.equal(request.url, "http://127.0.0.1:3211/api/dev/e2e-user"); assert.equal(request.headers["X-Dev-Fixture-Secret"], secret); assert.equal(request.redirect, "error");
  for (const url of ["https://hosted.convex.site", "http://user:pass@localhost:3211", "http://localhost:3211/?query=1"]) {
    const denied = execute(url, secret); assert.notEqual(denied.status, 0); assert.equal(denied.stdout, ""); assert.match(denied.stderr, /only send their capability to a local backend/);
  }
  const missing = execute("http://127.0.0.1:3211", ""); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /Local fixture secret is missing/); assert.equal(missing.stdout, "");
  fs.writeFileSync(file, legacy.replace('headers: { "Content-Type": "application/json" }', 'headers: customHeaders'));
  const custom = fs.readFileSync(file, "utf8"); assert.throws(() => migrate(root), /Custom fixture client requires review/); assert.equal(fs.readFileSync(file, "utf8"), custom);
});
