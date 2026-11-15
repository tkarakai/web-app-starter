import { test } from "node:test";
import assert from "node:assert/strict";
import { plannedPort } from "../e2e-ports.ts";

test("missing plan refuses startup", () => {
  assert.throws(() => plannedPort("missing"), /Invalid E2E port/);
});

test("the real listener probe avoids occupied defaults and shares a stable worker plan", async () => {
  const { createServer } = await import("node:net");
  const { e2eOrigin } = await import("../e2e-ports.ts");
  const { default: rawConfig } = await import("../../../app.config.ts");
  const server = createServer();
  const previous = process.env.PLATFORM_E2E_PORTS;
  delete process.env.PLATFORM_E2E_PORTS;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", (error: Error & { code?: string }) => error.code === "EADDRINUSE" ? resolve() : reject(error));
      server.listen(rawConfig.runtime.ports.web, resolve);
    });
    const origin = e2eOrigin("web");
    assert.notEqual(new URL(origin).port, String(rawConfig.runtime.ports.web));
    assert.equal(e2eOrigin("web"), origin);
    const plan = JSON.parse(process.env.PLATFORM_E2E_PORTS!) as Record<string, number>;
    assert.equal(new Set(Object.values(plan)).size, Object.keys(plan).length);
    // OS-assigned, so clear of every configured app port and of browser-blocked ports.
    for (const port of Object.values(plan)) assert.ok(port > 10080 && !Object.values(rawConfig.runtime.ports).includes(port), String(port));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.PLATFORM_E2E_PORTS;
    else process.env.PLATFORM_E2E_PORTS = previous;
  }
});

test("saved backend ports are staged without losing credentials or deployment identity, then restored", async t => {
  const fs = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { prepareBackendPorts, restoreBackendPorts } = await import("../e2e-ports.ts");
  const directory = fs.mkdtempSync(join(tmpdir(), "e2e-backend-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const previous = process.env.PLATFORM_E2E_PORTS;
  process.env.PLATFORM_E2E_PORTS = JSON.stringify({ cloud: 3212, site: 3213 });
  try {
    // A fresh checkout: Convex creates its state during the run; afterwards it gets Convex's defaults.
    prepareBackendPorts(directory);
    const saved = join(directory, ".convex/platform-e2e-saved-ports.json");
    assert.deepEqual(JSON.parse(fs.readFileSync(saved, "utf8")), { cloud: 3210, site: 3211 });
    assert.equal(fs.readFileSync(join(directory, ".convex/.gitignore"), "utf8"), "/*\n");
    fs.mkdirSync(join(directory, ".convex/local/default"), { recursive: true });
    const file = join(directory, ".convex/local/default/config.json");
    fs.writeFileSync(file, JSON.stringify({ adminKey: "fixture", deploymentName: "anonymous-agent", ports: { cloud: 59018, site: 59019 } }));
    restoreBackendPorts(directory);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).ports, { cloud: 3210, site: 3211 });
    fs.writeFileSync(file, JSON.stringify({ adminKey: "fixture", deploymentName: "anonymous-agent", ports: { cloud: 3230, site: 3231 } }));
    prepareBackendPorts(directory);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { adminKey: "fixture", deploymentName: "anonymous-agent", ports: { cloud: 3212, site: 3213 } });
    // An interrupted run must not replace the checkout's own ports with leased ones.
    process.env.PLATFORM_E2E_PORTS = JSON.stringify({ cloud: 50001, site: 50002 });
    prepareBackendPorts(directory);
    restoreBackendPorts(directory);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { adminKey: "fixture", deploymentName: "anonymous-agent", ports: { cloud: 3230, site: 3231 } });
    assert.equal(fs.existsSync(saved), false);
    restoreBackendPorts(directory);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).ports, { cloud: 3230, site: 3231 });
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_E2E_PORTS;
    else process.env.PLATFORM_E2E_PORTS = previous;
  }
});
