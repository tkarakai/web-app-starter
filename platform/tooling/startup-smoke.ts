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
let childClosed = false;
let unrelated: ChildProcess | undefined;
const unrelatedRoot = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "starter-unrelated-backend-")));
async function shutdown() {
  if (child && child.exitCode === null && child.signalCode === null) {
    // Bun can exit before its shell finishes the EXIT trap. Wait for inherited
    // output pipes to close before running a second ownership cleanup.
    const done = once(child, "close");
    try { process.kill(-child.pid!, "SIGTERM"); } catch { /* Already exited. */ }
    await Promise.race([done, new Promise(resolve => setTimeout(resolve, 10_000))]);
  }
  stop(fixture);
  if (child && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* Already exited. */ } }
}
function launch(args: string[], timeout = "30000", env: Record<string, string | undefined> = {}) {
  logs = "";
  childClosed = false;
  child = spawn("bun", args, { cwd: fixture, detached: true, env: { ...process.env, LANDING_URL: undefined, AGENT_MCP_ENABLED: undefined, AGENT_MCP_ORIGIN: undefined, AGENT_MCP_AUTH_ORIGIN: undefined, ORGANIZATION_MIGRATION_BATCH_SIZE: undefined, ...env, CI: "true", DEV_READY_TIMEOUT_MS: timeout, PATH: join(fixture, "bin") + delimiter + process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
  child.once("close", () => { childClosed = true; });
  child.stdout!.on("data", data => { logs += String(data); }); child.stderr!.on("data", data => { logs += String(data); });
}
async function until(check: () => boolean, ms = 90_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Startup smoke timed out\n" + logs);
}
try {
  const tools = ["package.json", "node-ts.sh", "dev-start.sh", "dev-convex.sh", "dev-processes.ts", "dev-stop.sh", "dev-status.sh", "dev-dashboard.sh", "app-config.ts", "agentic-origins.ts", "ensure-local-deps.sh", "ensure-app-env.sh", "copy-shared-assets.sh", "local-fixtures.ts", "organization-migration-check.ts", "http-ready.ts", "local-dev-deps.ts"];
  for (const name of tools) write("platform/tooling/" + name, fs.readFileSync(join(source, "platform/tooling", name), "utf8"));
  for (const file of ["platform/packages/app-config/src/schema.ts", ".github/actions/deploy-convex/fixture-target.ts", ".github/actions/deploy-convex/organization-target.ts", ".github/actions/deploy-convex/organization-source.ts"]) write(file, fs.readFileSync(join(source, file), "utf8"));
  for (const icon of Object.values(appConfig.brand.icons)) {
    const target = join(fixture, icon); fs.mkdirSync(dirname(target), { recursive: true }); fs.copyFileSync(join(source, icon), target);
  }
  write("app.config.ts", "export default " + JSON.stringify(appConfig));
  const root = JSON.parse(fs.readFileSync(join(source, "package.json"), "utf8"));
  const scripts: Record<string, string> = Object.fromEntries(Object.entries(root.scripts).filter(([name]) => ["dev", "predev", "dev:web", "dev:landing"].includes(name))) as Record<string, string>;
  scripts.postinstall = "node -e \"require('fs').appendFileSync('installs.log','install\\n')\"";
  json("package.json", { private: true, type: "module", packageManager: root.packageManager, workspaces: ["apps/*", "platform/apps/*", "packages/*"], scripts, dependencies: { esbuild: "workspace:*", typescript: root.devDependencies.typescript } });
  json("packages/esbuild/package.json", { name: "esbuild", version: "0.0.0", bin: "bin.cjs" }); write("packages/esbuild/bin.cjs", "#!/usr/bin/env node\nconsole.log('0.25.0')");
  json("packages/backend/package.json", { name: "@repo/backend", dependencies: { convex: "workspace:*" } });
  json("packages/convex/package.json", { name: "convex", version: "0.0.0", bin: "bin.cjs" });
  // This empty source inventory belongs only to the fake backend below. The real
  // launcher/scanner still run; this smoke does not deploy or migrate Convex data.
  const registry = { components: {}, functions: {}, jobs: {}, tables: {}, version: 1 };
  write("packages/backend/convex/organizationMigrationRegistry.ts", `export const organizationMigrationRegistry = ${JSON.stringify(registry)};`);
  write("packages/backend/convex/platform/organizationReadiness.ts", "export const ORGANIZATION_MIGRATION_CONTRACT_VERSION = 1;");
  write("packages/convex/bin.cjs", `#!/usr/bin/env node
const fs=require('node:fs');
const assert=require('node:assert/strict');
const args=process.argv.slice(2); const envAt=args.indexOf('--env-file');
if(envAt>=0) args.splice(envAt,2);
const stateFile='.convex/startup-smoke-state.json';
const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{env:{BETTER_AUTH_SECRET:'startup-only-fixture'},ready:false,calls:[]};
const save=()=>{fs.mkdirSync('.convex',{recursive:true});fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});};
const expectedRegistryHash=require('node:crypto').createHash('sha256').update(${JSON.stringify(JSON.stringify(registry))}).digest('hex');
const deployment='http://127.0.0.1:43210';
if(args[0]==='env') {
  if(args[1]==='list' && args[2]==='--names-only') console.log(Object.keys(state.env).join('\\n'));
  else if(args[1]==='get') console.log(state.env[args[2]]??'');
  else if(args[1]==='set') {
    if(args[2]==='--force') Object.assign(state.env,require('node:util').parseEnv(fs.readFileSync(0,'utf8')));
    else { assert.equal(args.length,4); state.env[args[2]]=args[3]; }
    if(args[2]==='ORGANIZATION_CUTOVER_ENFORCED') assert.equal(state.ready,true);
    save();
  } else throw new Error('Unsupported startup fixture env command');
  process.exit(0);
}
if(args[0]==='run') {
  const name=args[1]; const input=JSON.parse(args[2]??'{}'); let result=null;
  if(name.startsWith('organizationMigration:')) state.calls.push(name.split(':')[1]);
  if(name==='organizationMigration:status') result={deployment,expectedRegistryHash,ready:state.ready,deploymentVersion:state.deploymentVersion,registryHash:state.registryHash};
  else if(name==='organizationMigration:maintenance') { assert.equal(input.confirmDeployment,deployment);state.ready=false; }
  else if(name==='organizationMigration:begin') {
    assert.equal(input.confirmDeployment,deployment);assert.equal(input.deploymentVersion,state.env.ORGANIZATION_DEPLOYMENT_VERSION);
    assert.match(input.deploymentVersion,/^[a-f0-9]{64}$/);assert.equal(state.env.ORGANIZATION_REGISTRY_HASH,expectedRegistryHash);
    state.ready=false;state.begun=true;state.stepped=false;
  } else if(name==='organizationMigration:step') {
    assert.equal(state.begun,true);assert.equal(input.batchSize,10);
    if(process.env.STARTUP_SMOKE_BLOCK_ORGANIZATION==='1') { save();console.error('Uncaught Error: ORGANIZATION_STARTUP_FIXTURE_BLOCKED');process.exit(1); }
    state.stepped=true;result={complete:true};
  } else if(name==='organizationMigration:finalize') {
    assert.equal(state.begun,true);assert.equal(state.stepped,true);state.ready=true;
    state.deploymentVersion=state.env.ORGANIZATION_DEPLOYMENT_VERSION;state.registryHash=expectedRegistryHash;result={ready:true};
  } else if(!['platform/devSeed:seed','migrations'].includes(name)) throw new Error('Unsupported startup fixture run command');
  save();console.log(JSON.stringify(result));process.exit(0);
}
assert.equal(args[0],'dev','Unsupported startup fixture command');
fs.writeFileSync('.env.local','CONVEX_DEPLOYMENT=anonymous:startup-smoke\\nCONVEX_URL=http://127.0.0.1:43210\\nCONVEX_SITE_URL=http://127.0.0.1:43211\\n');
fs.mkdirSync('.convex/local/default',{recursive:true});
fs.writeFileSync('.convex/local/default/config.json',JSON.stringify({deploymentName:'startup-smoke',adminKey:'local-fixture',ports:{cloud:43210,site:43211}}));
console.log('Convex functions ready');setInterval(()=>{},1000);
`);
  const deps = Object.fromEntries(["next", "react", "react-dom", "tailwindcss", "@tailwindcss/postcss"].map(name => [name, JSON.parse(fs.readFileSync(join(source, "apps/landing/node_modules", name, "package.json"), "utf8")).version]));
  for (const app of ["web", "landing", "admin"]) {
    const dir = app === "admin" ? "platform/apps/admin" : `apps/${app}`;
    json(`${dir}/package.json`, { name: `@repo/${app}`, private: true, dependencies: deps });
    // Next consumes this configuration before listening. Capturing here proves
    // the launched consumer sees configuration on boot, before any hot reload.
    const keys = app === "web" ? ["LANDING_URL", "APP_ORIGIN"] : app === "landing" ? ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_WEB_APP_URL"] : ["APP_ORIGIN", "AGENT_MCP_ORIGIN", "AGENT_MCP_AUTH_ORIGIN"];
    write(`${dir}/next.config.mjs`, `import fs from 'node:fs';
const keys=${JSON.stringify(keys)};
for(const key of keys) if(!process.env[key]) throw new Error('Missing startup configuration: '+key);
fs.writeFileSync('startup.json',JSON.stringify(Object.fromEntries(keys.map(key=>[key,process.env[key]]))));
export default {turbopack:{root:${JSON.stringify(fixture)}}};`);
    write(`${dir}/postcss.config.mjs`, 'export default {plugins:{"@tailwindcss/postcss":{}}};');
    write(`${dir}/app/layout.jsx`, 'import "./globals.css"; export default function Layout({children}) {return <html lang="en"><body>{children}</body></html>}');
    write(`${dir}/app/page.jsx`, `export default function Page(){return <h1 className="workspace-proof">${app} fixture</h1>}`);
    write(`${dir}/app/sign-in/page.jsx`, 'export {default} from "../page";');
    write(`${dir}/app/globals.css`, '@import "tailwindcss";\n@import "@repo/onboarding/styles.css";');
  }
  command(["install"]); // Old revision: consumers do not yet declare the new package.
  json("packages/onboarding/package.json", { name: "@repo/onboarding", exports: { "./styles.css": "./styles.css" } });
  write("packages/onboarding/styles.css", ".workspace-proof { color: rgb(12, 34, 56); }");
  for (const app of ["web", "landing", "admin"]) json(`${app === "admin" ? "platform/apps/admin" : `apps/${app}`}/package.json`, { name: `@repo/${app}`, private: true, dependencies: { ...deps, "@repo/onboarding": "workspace:*" } });
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
  const boot = (dir: string) => JSON.parse(fs.readFileSync(join(fixture, dir, "startup.json"), "utf8")) as Record<string, string>;
  assert.equal(boot("apps/web").LANDING_URL, boot("apps/landing").NEXT_PUBLIC_SITE_URL);
  assert.equal(boot("apps/landing").NEXT_PUBLIC_WEB_APP_URL, boot("apps/web").APP_ORIGIN);
  const organizationState = () => JSON.parse(fs.readFileSync(join(fixture, "packages/backend/.convex/startup-smoke-state.json"), "utf8"));
  assert.equal(organizationState().ready, true, "launcher must finish the fake organization protocol before app startup");
  assert.deepEqual(organizationState().calls, ["status", "begin", "step", "status", "finalize", "status"]);
  await shutdown();
  launch(["dev", "--app=web,landing"], "30000", { STARTUP_SMOKE_BLOCK_ORGANIZATION: "1" });
  await until(() => childClosed, 60_000);
  assert.notEqual(child!.exitCode, 0, logs);
  assert.match(logs, /ORGANIZATION_STARTUP_FIXTURE_BLOCKED/);
  assert.ok(!logs.includes("[CI MODE] Staying in foreground"));
  assert.equal(organizationState().ready, false);
  assert.equal(organizationState().calls.at(-1), "step");
  assert.deepEqual(readRecords(fixture), {});
  for (const configured of [undefined, undefined, "https://landing.example.test"]) {
    fs.rmSync(join(fixture, "apps/web/.env.local"));
    fs.rmSync(join(fixture, "apps/web/.next"), { recursive: true, force: true });
    if (configured) write("apps/web/.env.local", `LANDING_URL=${configured}\n`);
    launch(["run", "dev:web"]);
    await until(() => { if (child!.exitCode !== null) throw new Error(logs); return logs.includes("[CI MODE] Staying in foreground"); });
    const config = boot("apps/web");
    assert.equal(config.LANDING_URL, configured ?? `http://localhost:${appConfig.runtime.ports.landing}`);
    assert.equal((await fetch(config.APP_ORIGIN + "/sign-in")).status, 200);
    await shutdown();
  }
  launch(["dev", "--app=admin"], "30000", { AGENT_MCP_ENABLED: "true" });
  await until(() => { if (child!.exitCode !== null) throw new Error(logs); return logs.includes("[CI MODE] Staying in foreground"); });
  const admin = boot("platform/apps/admin");
  assert.equal(admin.AGENT_MCP_ORIGIN, admin.APP_ORIGIN);
  assert.equal(admin.AGENT_MCP_AUTH_ORIGIN, `http://mcp-auth.localhost:${new URL(admin.APP_ORIGIN).port}`);
  assert.equal((await fetch(admin.APP_ORIGIN + "/sign-in")).status, 200);
  await shutdown();
  write("packages/onboarding/styles.css", '@import "missing-startup-fixture-package";');
  launch(["run", "dev:landing"], "2500");
  await until(() => childClosed, 60_000);
  assert.notEqual(child!.exitCode, 0, logs);
  assert.match(logs, /NOT ready/);
  assert.deepEqual(readRecords(fixture), {});
  write("packages/onboarding/styles.css", ".workspace-proof { color: rgb(12, 34, 56); }");
  write("apps/landing/next.config.mjs", "throw new Error('FORCED_LATER_CONFIG_FAILURE');");
  const database = join(fixture, "packages/backend/.convex/local/default/database-proof");
  fs.writeFileSync(database, "preserve local database");
  unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: unrelatedRoot, stdio: "ignore" });
  launch(["dev", "--app=web,landing"], "2500");
  await until(() => childClosed, 60_000);
  assert.notEqual(child!.exitCode, 0, logs);
  assert.match(fs.readFileSync(join(fixture, ".next-web.log"), "utf8"), /Ready/);
  assert.match(fs.readFileSync(join(fixture, ".next-landing.log"), "utf8"), /FORCED_LATER_CONFIG_FAILURE/);
  assert.deepEqual(readRecords(fixture), {});
  assert.equal(fs.readFileSync(database, "utf8"), "preserve local database");
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
  process.kill(unrelated.pid!, 0);
  console.log("Real startup smoke passed: configuration available at Next boot; repeated fresh web sign-in HTTP 200; web/landing links and admin MCP origins staged; stale workspace repaired once; HTML + CSS compiled; failure cleanup preserves unrelated processes and database state.");
} finally {
  await shutdown();
  if (unrelated && unrelated.exitCode === null && unrelated.signalCode === null) {
    const done = once(unrelated, "exit"); unrelated.kill("SIGKILL"); await done;
  }
  fs.rmSync(unrelatedRoot, { recursive: true, force: true });
  fs.rmSync(fixture, { recursive: true, force: true });
}
