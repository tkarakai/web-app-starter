import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";

const script = fileURLToPath(new URL("../../.github/actions/setup-bun/setup-bun-act.sh", import.meta.url));

function fixture(t: TestContext, cached?: string, installerVersion = "1.4.2", downloadFails = false) {
  const root = mkdtempSync(join(process.cwd(), ".bun-cache-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const install = join(root, "bun cache");
  const mocks = join(root, "mocks");
  const output = join(root, "path");
  const calls = join(root, "calls");
  mkdirSync(join(install, "bin"), { recursive: true });
  mkdirSync(mocks);
  writeFileSync(output, "");
  writeFileSync(calls, "");
  if (cached) writeFileSync(join(install, "bin/bun"), `#!/bin/sh\necho '${cached}'\n`, { mode: 0o755 });
  writeFileSync(join(mocks, "curl"), `#!/bin/sh
printf 'download\\n' >> "$CALLS"
${downloadFails ? "exit 22" : `cat <<'INSTALLER'
[ "$1" = 'bun-v1.4.2' ] || exit 2
printf '#!/bin/sh\\necho ${installerVersion}\\n' > "$BUN_INSTALL/bin/bun"
chmod +x "$BUN_INSTALL/bin/bun"
INSTALLER`}
`, { mode: 0o755 });
  const result = spawnSync("bash", [script], {
    env: { ...process.env, PATH: `${mocks}:${process.env.PATH}`, BUN_INSTALL: install,
      BUN_VERSION: "1.4.2", GITHUB_PATH: output, CALLS: calls },
    encoding: "utf8", timeout: 5000,
  });
  assert.ifError(result.error);
  return { result, paths: readFileSync(output, "utf8"), calls: readFileSync(calls, "utf8"), install };
}

test("act reuses the exact requested Bun without a network request", (t) => {
  const f = fixture(t, "1.4.2");
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.calls, "");
  assert.equal(f.paths, `${f.install}/bin\n`);
});

for (const cached of [undefined, "1.3.6"]) {
  test(`act installs requested Bun with ${cached ?? "missing"} cache`, (t) => {
    const f = fixture(t, cached);
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(f.calls, "download\n");
    assert.equal(f.paths, `${f.install}/bin\n`);
    const version = spawnSync(join(f.install, "bin/bun"), ["--version"], { encoding: "utf8" });
    assert.equal(version.stdout.trim(), "1.4.2");
  });
}

for (const [version, fails] of [["1.3.6", false], ["1.4.2", true]] as const) {
  test(`act rejects ${fails ? "download failure" : "a wrong-version installer"} without publishing a path`, (t) => {
    const f = fixture(t, "1.3.6", version, fails);
    assert.notEqual(f.result.status, 0);
    assert.equal(f.calls, "download\n");
    assert.equal(f.paths, "");
  });
}
