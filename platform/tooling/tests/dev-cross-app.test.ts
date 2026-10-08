import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

// Execute the launcher's configuration/start boundary with external consumers.
// The receipt is generated public startup output, not implementation text evidence.
const launcher = fs.readFileSync(new URL("../dev-start.sh", import.meta.url), "utf8");
const startup = launcher.slice(launcher.indexOf("# Select all ports and stage"), launcher.indexOf("# In CI mode, show final env contents"));

for (const mode of ["all", "web", "admin", "landing"]) {
  for (const configured of [false, true]) test(`${mode} startup supplies configuration before launch (configured=${configured})`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-cross-app-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const dir of ["apps/web", "platform/apps/admin", "apps/landing", "packages/backend", "bin"]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(root, "apps/web/.env.local"), `LANDING_URL=${configured ? "https://landing.example.test" : ""}\n`);
    fs.writeFileSync(path.join(root, "apps/landing/.env.local"), `NEXT_PUBLIC_WEB_APP_URL=${configured ? "https://web.example.test" : ""}\n`);
    fs.writeFileSync(path.join(root, "bin/convex.cjs"), `const fs=require('node:fs'); const file=process.env.PROJECT_DIR+'/backend.json';
const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
if(process.env.FAIL_MCP_ORIGIN_SYNC==='true'&&process.argv[4]==='SITE_URL'&&process.argv[5].includes('auth.localhost'))process.exit(1);
state[process.argv[4]]=process.argv[5];fs.writeFileSync(file,JSON.stringify(state));`);
    fs.writeFileSync(path.join(root, "bin/consumer.cjs"), `const fs=require('node:fs');
process.loadEnvFile(process.argv[2]+'/.env.local');
const keys=['APP_ORIGIN','LANDING_URL','NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_WEB_APP_URL','AGENT_MCP_ENABLED','AGENT_MCP_ORIGIN','AGENT_MCP_AUTH_ORIGIN'];
fs.writeFileSync(process.argv[2]+'/startup.json',JSON.stringify({env:Object.fromEntries(keys.filter(k=>process.env[k]).map(k=>[k,process.env[k]])),backend:JSON.parse(fs.readFileSync(process.env.PROJECT_DIR+'/backend.json'))}));`);
    const run = (failMcpOriginSync = false) => spawnSync("bash", ["-eu", "-c", `
      find_available_port() { echo "$(( $1 + 10 ))"; }
      app_dir() { case "$1" in admin) echo "$PROJECT_DIR/platform/apps/admin";; *) echo "$PROJECT_DIR/apps/$1";; esac; }
      start_next_app() { node "$PROJECT_DIR/bin/consumer.cjs" "$(app_dir "$1")"; }
      update_env_var() { printf '%s=%s\\n' "$2" "$3" >> "$1"; }
      ${startup}
    `], { encoding: "utf8", env: {
      ...process.env, FAIL_MCP_ORIGIN_SYNC: String(failMcpOriginSync), LANDING_URL: undefined, NEXT_PUBLIC_WEB_APP_URL: undefined,
      AGENT_MCP_ENABLED: "true", AGENT_MCP_ORIGIN: undefined, AGENT_MCP_AUTH_ORIGIN: configured ? "http://custom-auth.localhost:43011" : undefined,
      PROJECT_DIR: root, CONVEX_BIN: path.join(root, "bin/convex.cjs"),
      NODE_TS: path.resolve(import.meta.dirname, "../node-ts.sh"), SCRIPT_DIR: path.resolve(import.meta.dirname, ".."),
      APP_CONFIG_PORT_LANDING: "43004", APP_CONFIG_ORIGIN_LANDING: "http://localhost:43004",
      APP_CONFIG_PORT_WEB: "43000", APP_CONFIG_PORT_ADMIN: "43001",
      APP_CONFIG_ORIGIN_WEB: "http://localhost:43000", APP_CONFIG_ORIGIN_ADMIN: "http://localhost:43001",
      START_WEB: String(mode === "all" || mode === "web"), START_ADMIN: String(mode === "all" || mode === "admin"),
      START_LANDING: String(mode === "all" || mode === "landing"), START_STORYBOOK: "false",
      NEED_CONVEX: "true", GREEN: "", NC: "", YELLOW: "",
    } });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    for (const app of mode === "all" ? ["web", "admin", "landing"] : [mode]) {
      const dir = app === "admin" ? "platform/apps/admin" : `apps/${app}`;
      const receipt = JSON.parse(fs.readFileSync(path.join(root, dir, "startup.json"), "utf8"));
      assert.equal(receipt.backend.LANDING_URL, `http://localhost:${mode === "all" || mode === "landing" ? 43014 : 43004}`);
      if (app === "web") {
        assert.equal(receipt.env.APP_ORIGIN, "http://localhost:43010");
        assert.equal(receipt.env.LANDING_URL, mode === "all" ? "http://localhost:43014" : configured ? "https://landing.example.test" : "http://localhost:43004");
      }
      if (app === "landing") {
        assert.equal(receipt.env.NEXT_PUBLIC_SITE_URL, "http://localhost:43014");
        assert.equal(receipt.env.NEXT_PUBLIC_WEB_APP_URL, mode === "all" ? "http://localhost:43010" : configured ? "https://web.example.test" : "http://localhost:43000");
      }
      if (app === "admin") {
        assert.equal(receipt.env.APP_ORIGIN, "http://localhost:43011");
        assert.equal(receipt.env.AGENT_MCP_ENABLED, "true");
        assert.equal(receipt.env.AGENT_MCP_ORIGIN, "http://localhost:43011");
        assert.equal(receipt.env.AGENT_MCP_AUTH_ORIGIN, `http://${configured ? "custom-auth" : "mcp-auth"}.localhost:43011`);
        assert.equal(receipt.backend.AGENT_MCP_RESOURCE, "http://localhost:43011/api/mcp");
        assert.equal(receipt.backend.AGENT_MCP_AUTH_ORIGIN, receipt.env.AGENT_MCP_AUTH_ORIGIN);
        assert.ok(receipt.backend.SITE_URL.split(",").includes(receipt.env.AGENT_MCP_AUTH_ORIGIN));
      }
    }
    if (mode === "all" || mode === "admin") {
      const receiptFiles = (mode === "all" ? ["apps/web", "platform/apps/admin", "apps/landing"] : ["platform/apps/admin"])
        .map(dir => path.join(root, dir, "startup.json"));
      for (const file of receiptFiles) fs.unlinkSync(file);
      const rejected = run(true);
      assert.notEqual(rejected.status, 0, "MCP origin registration must fail closed");
      for (const file of receiptFiles) assert.equal(fs.existsSync(file), false, "no consumer launches after MCP origin sync fails");
    }
  });
}
