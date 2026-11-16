/** E2E fixture helpers must call the managed run's own backend, not a stale exported URL (#414 follow-up). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

async function deadPort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

// Platform-owned helpers only: platform tests run in adopted apps, whose apps/web copy is theirs
// and is not replaced on upgrade. The reference web helper is covered by the starter's web E2E.
for (const helper of ["platform/apps/admin/qa/e2e/helpers/fixtures.ts"]) {
  test(`${helper} uses the managed plan's backend over an exported CONVEX_SITE_URL`, async t => {
    const requests: string[] = [];
    const backend = createHttpServer((request, response) => { requests.push(`${request.method} ${request.url}`); response.setHeader("Content-Type", "application/json"); response.end("{}"); });
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    t.after(() => backend.close());
    const site = (backend.address() as AddressInfo).port;
    const stale = await deadPort();
    const script = `import { createDisposableUser } from ${JSON.stringify(path.join(root, helper))};
await createDisposableUser();`;
    // Like a lab or shell that still exports the old default URL while the run planned other ports.
    // Asynchronous: the stub backend in this process must keep serving while the helper runs.
    const child = spawn(path.join(root, "platform/tooling/node-ts.sh"), ["--input-type=module", "-e", script], {
      cwd: root, stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, PLATFORM_E2E_PORTS: JSON.stringify({ cloud: stale, site }), CONVEX_SITE_URL: `http://127.0.0.1:${stale}`, CONVEX_URL: `http://127.0.0.1:${stale}`, DEV_FIXTURE_SECRET: "a".repeat(64) },
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    const [status] = await once(child, "exit") as [number | null];
    assert.equal(status, 0, stderr);
    assert.deepEqual(requests, ["POST /api/dev/e2e-user"]);
  });
}
