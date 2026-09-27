import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";

const script = fileURLToPath(new URL("../../../.github/actions/setup-bun/find-node.sh", import.meta.url));

function fixture(t: TestContext) {
  const root = mkdtempSync(join(process.cwd(), ".node-cache-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cache = join(root, "tool cache");
  const output = join(root, "output");
  const path = join(root, "path");

  function install(version: string, arch: string, reportedVersion = version, exitCode = 0): string {
    const bin = join(cache, "node", version, arch, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "node"), `#!/bin/sh\necho v${reportedVersion}\nexit ${exitCode}\n`, { mode: 0o755 });
    return bin;
  }

  function run(arch = "X64", version = "24") {
    writeFileSync(output, "");
    writeFileSync(path, "");
    const result = spawnSync("bash", [script], {
      env: {
        ...process.env,
        RUNNER_TOOL_CACHE: cache,
        RUNNER_ARCH: arch,
        NODE_VERSION: version,
        GITHUB_OUTPUT: output,
        GITHUB_PATH: path,
      },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return {
      outputs: Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map((line) => line.split("="))),
      path: readFileSync(path, "utf8"),
    };
  }
  return { install, run };
}

test("missing cache and Node 20-only cache request installer setup without failing", (t) => {
  const { install, run } = fixture(t);
  assert.deepEqual(run(), { outputs: { found: "false" }, path: "" });
  install("20.19.0", "x64");
  assert.deepEqual(run(), { outputs: { found: "false" }, path: "" });
});

for (const [runnerArch, nodeArch] of [["X64", "x64"], ["ARM64", "arm64"]]) {
  test(`reuses a working Node 24 cache for ${runnerArch}`, (t) => {
    const { install, run } = fixture(t);
    install("20.19.0", nodeArch);
    const bin = install("24.1.0", nodeArch);
    install("24.1.0", nodeArch === "x64" ? "arm64" : "x64");
    assert.deepEqual(run(runnerArch), { outputs: { found: "true" }, path: `${bin}\n` });
    const selected = spawnSync(join(bin, "node"), ["--version"], { encoding: "utf8" });
    assert.equal(selected.status, 0);
    assert.equal(selected.stdout.trim(), "v24.1.0");
  });
}

test("wrong architecture, broken binary, and mislabeled cache request installer setup", (t) => {
  const { install, run } = fixture(t);
  install("24.1.0", "arm64");
  install("24.2.0", "x64", "24.2.0", 1);
  install("24.3.0", "x64", "20.19.0");
  assert.deepEqual(run(), { outputs: { found: "false" }, path: "" });
  const bin = install("24.4.0", "x64");
  assert.deepEqual(run(), { outputs: { found: "true" }, path: `${bin}\n` });
});

test("delegates other version selectors and architectures to setup-node", (t) => {
  const { install, run } = fixture(t);
  install("24.1.0", "x64");
  for (const version of ["24.1.0", "24.x", "lts/*"]) {
    assert.deepEqual(run("X64", version), { outputs: { found: "false" }, path: "" });
  }
  assert.deepEqual(run("ARM"), { outputs: { found: "false" }, path: "" });
});
