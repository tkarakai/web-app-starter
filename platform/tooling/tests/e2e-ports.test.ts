import { test } from "node:test";
import assert from "node:assert/strict";
import { selectPorts, plannedPort } from "../e2e-ports.ts";

test("occupied defaults and overlapping ranges select distinct free ports", () => {
  const occupied = new Set([3000, 3001, 3002, 3003, 3210, 3211]);
  assert.deepEqual(selectPorts({ web: 3001, admin: 3002, landing: 3000, storybook: 3003, cloud: 3210, site: 3211 }, p => occupied.has(p)),
    { web: 3004, admin: 3005, landing: 3006, storybook: 3007, cloud: 3212, site: 3213 });
});
test("free defaults stay unchanged", () => {
  assert.deepEqual(selectPorts({ web: 3001, cloud: 3210 }, () => false), { web: 3001, cloud: 3210 });
});
test("exhaustion identifies the range", () => {
  assert.throws(() => selectPorts({ web: 3001 }, () => true), /3001 and 3011/);
});
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
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.PLATFORM_E2E_PORTS;
    else process.env.PLATFORM_E2E_PORTS = previous;
  }
});
