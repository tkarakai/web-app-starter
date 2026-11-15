import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const launcher = fs.readFileSync(new URL("../dev-start.sh", import.meta.url), "utf8");
const portSelection = launcher.slice(launcher.indexOf("find_available_port() {"), launcher.indexOf("start_next_app() {"));

for (const mode of ["closed-browser", "outgoing-browser", "listener"] as const) {
  test(`port selection handles ${mode} sockets`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-ports-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    // Model lsof's distinction between any connection mentioning a port and a bound TCP listener.
    fs.writeFileSync(path.join(root, "lsof"), `#!/bin/bash
if [[ "$*" == *"43002"* ]]; then
  if [[ "$PORT_FIXTURE" == listener || "$*" != *"-sTCP:LISTEN"* ]]; then exit 0; fi
fi
exit 1
`, { mode: 0o755 });
    const result = spawnSync("bash", ["-eu", "-c", `${portSelection}\nfind_available_port 43002`], {
      encoding: "utf8", env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, PORT_FIXTURE: mode },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), mode === "listener" ? "43003" : "43002");
  });
}

test("port selection excludes planned listeners and refuses an unknown startup port", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-ports-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "lsof"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
  const env = { ...process.env, PATH: root + path.delimiter + process.env.PATH };
  const planned = spawnSync("bash", ["-eu", "-c", `${portSelection}\nSELECTED_PORTS='43002 43003'; find_available_port 43002`], { encoding: "utf8", env });
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(planned.stdout.trim(), "43004");
  fs.writeFileSync(path.join(root, "lsof"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const exhausted = spawnSync("bash", ["-eu", "-c", `${portSelection}\nfind_available_port 43002`], { encoding: "utf8", env });
  assert.notEqual(exhausted.status, 0);
  assert.equal(exhausted.stdout, "");
  assert.match(exhausted.stderr, /No available local port/);
});

test("two launchers selecting at the same moment never pick the same port (#414)", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-ports-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Nothing listens yet: both launchers would bind seconds later.
  fs.writeFileSync(path.join(root, "lsof"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
  const tooling = path.dirname(new URL(import.meta.url).pathname).replace(/\/tests$/, "");
  const env = { ...process.env, PATH: root + path.delimiter + process.env.PATH, PLATFORM_PORT_LEASE_DIR: path.join(root, "leases") };
  const { spawn } = await import("node:child_process");
  const select = () => new Promise<string>((resolve, reject) => {
    // Each launcher holds its selection for a while, as dev-start does until Next listens.
    const child = spawn("bash", ["-eu", "-c", `SCRIPT_DIR=${JSON.stringify(tooling)}; NODE_TS="$SCRIPT_DIR/node-ts.sh"\n${portSelection}\nfind_available_port 43002; sleep 2`], { env });
    let output = "";
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.once("exit", code => code === 0 ? resolve(output.trim()) : reject(new Error(`exit ${code}`)));
  });
  const [first, second] = await Promise.all([select(), select()]);
  assert.notEqual(first, second);
});
