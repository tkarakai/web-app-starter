import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const launcher = fs.readFileSync(new URL("../dev-start.sh", import.meta.url), "utf8");
const startup = launcher.slice(launcher.indexOf("# Start apps in dependency order:"), launcher.indexOf("# UPDATE BETTER AUTH WITH ALL APP URLS"));

for (const mode of ["all", "web", "admin", "landing"]) {
  test(`${mode} startup seeds the landing URL whenever Convex is needed`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-cross-app-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const dir of ["apps/web", "platform/apps/admin", "apps/landing", "packages/backend", "bin"]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(root, "bin/bunx"), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$PROJECT_DIR/convex-calls"\n', { mode: 0o755 });
    const needConvex = true;
    const result = spawnSync("bash", ["-eu", "-c", `
      start_next_app() { LAST_APP_URL="http://localhost:$(( $2 + 10 ))"; }
      update_env_var() { printf '%s=%s\\n' "$2" "$3" >> "$1"; }
      ${startup}
    `], { encoding: "utf8", env: {
      ...process.env, PATH: path.join(root, "bin") + path.delimiter + process.env.PATH,
      PROJECT_DIR: root, APP_CONFIG_DIR_LANDING: "apps/landing",
      APP_CONFIG_PORT_LANDING: "43004", APP_CONFIG_ORIGIN_LANDING: "http://localhost:43004",
      APP_CONFIG_PORT_WEB: "43000", APP_CONFIG_PORT_ADMIN: "43001",
      APP_CONFIG_DIR_WEB: "apps/web", APP_CONFIG_ORIGIN_WEB: "http://localhost:43000",
      APP_CONFIG_ORIGIN_ADMIN: "http://localhost:43001",
      START_WEB: String(mode === "all" || mode === "web"), START_ADMIN: String(mode === "all" || mode === "admin"),
      START_LANDING: String(mode === "all" || mode === "landing"), START_STORYBOOK: "false",
      NEED_CONVEX: String(needConvex), GREEN: "", NC: "", YELLOW: "",
    } });
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.existsSync(path.join(root, "convex-calls")) ? fs.readFileSync(path.join(root, "convex-calls"), "utf8").trim().split("\n") : [];
    assert.deepEqual(calls.filter(call => call.startsWith("convex env set LANDING_URL ")), [
      `convex env set LANDING_URL http://localhost:${mode === "all" || mode === "landing" ? 43014 : 43004}`,
    ]);
  });
}
