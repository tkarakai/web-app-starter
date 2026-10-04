/** Real Next/Tailwind compilation through public Bun startup after a workspace is added.
 * Convex's executable boundary is a local fixture: backend persistence is covered by E2E.
 * No developer backend, home state or remote deployment is used by this smoke.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, delimiter } from "node:path";
import { createRequire } from "node:module";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { stop, readRecords } from "./dev-processes.ts";
import appConfig from "../../app.config.ts";

const source = resolve(import.meta.dirname, "../..");
const fixture = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "starter-real-next-")));
const write = (file: string, content: string) => { const path = join(fixture, file); fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, content, { mode: 0o755 }); };
const json = (file: string, value: unknown) => write(file, JSON.stringify(value, null, 2));
const command = (args: string[]) => execFileSync("bun", args, { cwd: fixture, encoding: "utf8", stdio: "pipe", timeout: 120_000 });
let child: ChildProcess | undefined, logs = "";
let unrelated: ChildProcess | undefined;
const unrelatedRoot = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "starter-unrelated-backend-")));
async function shutdown() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const done = once(child, "exit");
    try { process.kill(-child.pid!, "SIGTERM"); } catch { /* Already exited. */ }
    await Promise.race([done, new Promise(resolve => setTimeout(resolve, 10_000))]);
  }
  stop(fixture);
  if (child && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* Already exited. */ } }
}
function launch(args: string[], timeout = "30000") {
  logs = "";
  child = spawn("bun", args, { cwd: fixture, detached: true, env: { ...process.env, CI: "true", DEV_READY_TIMEOUT_MS: timeout, PATH: join(fixture, "bin") + delimiter + process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", data => { logs += String(data); }); child.stderr!.on("data", data => { logs += String(data); });
}
async function until(check: () => boolean, ms = 90_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Startup smoke timed out\n" + logs);
}
try {
  const tools = ["package.json", "node-ts.sh", "dev-start.sh", "dev-convex.sh", "dev-processes.ts", "dev-stop.sh", "dev-status.sh", "dev-dashboard.sh", "app-config.ts", "ensure-local-deps.sh", "ensure-app-env.sh", "copy-shared-assets.sh", "local-fixtures.ts", "http-ready.ts", "local-dev-deps.ts"];
  for (const name of tools) write("platform/tooling/" + name, fs.readFileSync(join(source, "platform/tooling", name), "utf8"));
  for (const file of ["platform/packages/app-config/src/schema.ts", ".github/actions/deploy-convex/fixture-target.ts"]) write(file, fs.readFileSync(join(source, file), "utf8"));
  for (const icon of Object.values(appConfig.brand.icons)) {
    const target = join(fixture, icon); fs.mkdirSync(dirname(target), { recursive: true }); fs.copyFileSync(join(source, icon), target);
  }
  write("app.config.ts", "export default " + JSON.stringify(appConfig));
  const root = JSON.parse(fs.readFileSync(join(source, "package.json"), "utf8"));
  const scripts: Record<string, string> = Object.fromEntries(Object.entries(root.scripts).filter(([name]) => ["dev", "predev", "dev:web", "dev:landing"].includes(name))) as Record<string, string>;
  scripts.postinstall = "node -e \"require('fs').appendFileSync('installs.log','install\\n')\"";
  json("package.json", { private: true, type: "module", packageManager: root.packageManager, workspaces: ["apps/*", "packages/*"], scripts, dependencies: { esbuild: "workspace:*" } });
  json("packages/esbuild/package.json", { name: "esbuild", version: "0.0.0", bin: "bin.cjs" }); write("packages/esbuild/bin.cjs", "#!/usr/bin/env node\nconsole.log('0.25.0')");
  json("packages/backend/package.json", { name: "@repo/backend", dependencies: { convex: "workspace:*" } });
  json("packages/convex/package.json", { name: "convex", version: "0.0.0", bin: "bin.cjs" });
  write("packages/convex/bin.cjs", "#!/usr/bin/env node\nif(process.argv[2]==='env' && process.argv[3]==='set' && process.argv[4]==='--force'){require('fs').readFileSync(0,'utf8');} else if(process.argv[3]==='get')console.log('fixture');");
  write("packages/convex/bin.cjs", `#!/usr/bin/env node
if(process.argv[2]!=='dev'){console.log('fixture');process.exit(0);}
const fs=require('node:fs');
fs.writeFileSync('.env.local','CONVEX_DEPLOYMENT=anonymous:startup-smoke\\nCONVEX_URL=http://127.0.0.1:43210\\nCONVEX_SITE_URL=http://127.0.0.1:43211\\n');
fs.mkdirSync('.convex/local/default',{recursive:true});
fs.writeFileSync('.convex/local/default/config.json',JSON.stringify({deploymentName:'startup-smoke',adminKey:'local-fixture',ports:{cloud:43210,site:43211}}));
console.log('Convex functions ready');setInterval(()=>{},1000);
`);
  const deps = Object.fromEntries(["next", "react", "react-dom", "tailwindcss", "@tailwindcss/postcss"].map(name => [name, JSON.parse(fs.readFileSync(join(source, "apps/landing/node_modules", name, "package.json"), "utf8")).version]));
  for (const app of ["web", "landing"]) {
    json(`apps/${app}/package.json`, { name: `@repo/${app}`, private: true, dependencies: deps });
    write(`apps/${app}/next.config.mjs`, `export default {turbopack:{root:${JSON.stringify(fixture)}}};`);
    write(`apps/${app}/postcss.config.mjs`, 'export default {plugins:{"@tailwindcss/postcss":{}}};');
    write(`apps/${app}/app/layout.jsx`, 'import "./globals.css"; export default function Layout({children}) {return <html lang="en"><body>{children}</body></html>}');
    write(`apps/${app}/app/page.jsx`, `export default function Page(){return <h1 className="workspace-proof">${app} fixture</h1>}`);
    write(`apps/${app}/app/sign-in/page.jsx`, 'export {default} from "../page";');
    write(`apps/${app}/app/globals.css`, '@import "tailwindcss";\n@import "@repo/onboarding/styles.css";');
  }
  command(["install"]); // Old revision: consumers do not yet declare the new package.
  json("packages/onboarding/package.json", { name: "@repo/onboarding", exports: { "./styles.css": "./styles.css" } });
  write("packages/onboarding/styles.css", ".workspace-proof { color: rgb(12, 34, 56); }");
  for (const app of ["web", "landing"]) json(`apps/${app}/package.json`, { name: `@repo/${app}`, private: true, dependencies: { ...deps, "@repo/onboarding": "workspace:*" } });
  command(["install", "--lockfile-only", "--ignore-scripts"]); // Incoming revision's lockfile, without installing it.
  assert.throws(() => createRequire(join(fixture, "apps/web/package.json")).resolve("@repo/onboarding/styles.css"));
  fs.writeFileSync(join(fixture, "installs.log"), "");
  launch(["dev", "--app=web,landing"]);
  await until(() => { if (child!.exitCode !== null) throw new Error(logs); return logs.includes("[CI MODE] Staying in foreground"); });
  for (const app of ["web", "landing"]) {
    const log = fs.readFileSync(join(fixture, `.next-${app}.log`), "utf8");
    const url = log.match(/http:\/\/localhost:\d+/)?.[0]; assert.ok(url, log);
    const origin = new URL(`http://127.0.0.1:${new URL(url).port}`);
    const response = await fetch(origin, { redirect: "error" }); assert.equal(response.status, 200, logs);
    const html = await response.text(); assert.ok(html.includes(`${app} fixture`));
    const styles = [...html.matchAll(/href="([^"]+\.css(?:\?[^"]*)?)"/g)]; assert.ok(styles.length, html);
    let css = "";
    for (const [, href] of styles) {
      const assetUrl = new URL(href.replaceAll("&amp;", "&"), origin);
      if (assetUrl.origin !== origin.origin || assetUrl.username || assetUrl.password) {
        throw new Error("Fixture assets must use the loopback origin without credentials");
      }
      const asset: Response = await fetch(assetUrl, { redirect: "error" }); assert.equal(asset.status, 200); css += await asset.text();
    }
    assert.match(css, /workspace-proof/);
  }
  assert.equal(fs.readFileSync(join(fixture, "installs.log"), "utf8"), "install\n", "one preflight install per public command");
  await shutdown();
  write("packages/onboarding/styles.css", '@import "missing-startup-fixture-package";');
  launch(["run", "dev:landing"], "2500");
  await until(() => child!.exitCode !== null, 60_000);
  assert.notEqual(child!.exitCode, 0, logs);
  assert.match(logs, /NOT ready/);
  assert.deepEqual(readRecords(fixture), {});
  write("packages/onboarding/styles.css", ".workspace-proof { color: rgb(12, 34, 56); }");
  write("apps/landing/next.config.mjs", "throw new Error('FORCED_LATER_CONFIG_FAILURE');");
  const database = join(fixture, "packages/backend/.convex/local/default/database-proof");
  fs.writeFileSync(database, "preserve local database");
  unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: unrelatedRoot, stdio: "ignore" });
  launch(["dev", "--app=web,landing"], "2500");
  await until(() => child!.exitCode !== null, 60_000);
  assert.notEqual(child!.exitCode, 0, logs);
  assert.match(fs.readFileSync(join(fixture, ".next-web.log"), "utf8"), /Ready/);
  assert.match(fs.readFileSync(join(fixture, ".next-landing.log"), "utf8"), /FORCED_LATER_CONFIG_FAILURE/);
  assert.deepEqual(readRecords(fixture), {});
  assert.equal(fs.readFileSync(database, "utf8"), "preserve local database");
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
  process.kill(unrelated.pid!, 0);
  console.log("Real startup smoke passed: stale workspace repaired once; web/landing HTML + CSS compiled; invalid CSS and later app config failures cleaned up while preserving unrelated processes and local database state.");
} finally {
  await shutdown();
  if (unrelated && unrelated.exitCode === null && unrelated.signalCode === null) {
    const done = once(unrelated, "exit"); unrelated.kill("SIGKILL"); await done;
  }
  fs.rmSync(unrelatedRoot, { recursive: true, force: true });
  fs.rmSync(fixture, { recursive: true, force: true });
}
