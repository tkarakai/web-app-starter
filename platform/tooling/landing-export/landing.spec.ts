import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { once } from "node:events";

let server: Server, origin: string;
const configured = process.env.EXPORT_EXPECT_CONFIGURED !== "false";
test.beforeAll(async () => {
  const root = resolve("out");
  server = createServer((req, res) => {
    try {
      let file = resolve(root, "." + decodeURIComponent(new URL(req.url!, "http://localhost").pathname));
      if (!file.startsWith(root + sep)) throw new Error("outside export");
      if (statSync(file).isDirectory()) file = resolve(file, "index.html");
      const types: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".svg": "image/svg+xml", ".json": "application/json" };
      res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
      res.end(readFileSync(file));
    } catch { res.writeHead(404); res.end("not found"); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing server address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(() => { server?.closeAllConnections(); server?.close(); });

test("built landing hydrates with working assets and the expected onboarding configuration", async ({ page }) => {
  const failures: string[] = [], apiRequests: string[] = [];
  let payload: { email: string } | undefined;
  page.on("pageerror", error => failures.push(error.message));
  page.on("response", response => { if (response.url().startsWith(origin) && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.route("**/api/**", route => {
    const url = route.request().url(); apiRequests.push(url);
    if (url.endsWith("/api/waitlist/status")) return route.fulfill({ json: { onboardingType: "publicWaitlist" } });
    if (url.endsWith("/api/waitlist/join")) { payload = route.request().postDataJSON(); return route.fulfill({ json: { success: true } }); }
    return route.fulfill({ json: { announcement: null } });
  });
  expect((await page.goto(origin + "/en/"))?.status()).toBe(200);
  await expect(page.locator("h1")).toBeVisible();
  expect(await page.locator('link[rel="stylesheet"]').count()).toBeGreaterThan(0);
  if (configured) {
    const email = page.locator('input[type="email"]').first();
    await expect(email).toBeVisible(); await email.fill("Artifact@Example.test");
    await email.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
    await expect.poll(() => payload?.email).toBe("artifact@example.test");
    expect(apiRequests.some(url => url.endsWith("/api/waitlist/status"))).toBe(true);
    expect(apiRequests.some(url => url.startsWith(origin))).toBe(false);
  } else {
    await expect(page.locator('a[href$="/en/sign-in"]')).not.toHaveCount(0);
    await page.waitForLoadState("networkidle");
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    expect(apiRequests).toEqual([]);
  }
  expect(failures).toEqual([]);
});
