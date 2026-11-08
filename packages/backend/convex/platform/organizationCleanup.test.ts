// Removing a deleted organization's app data: progress is durable, failures are retried with
// backoff and then left for an administrator, and a finished cleanup never runs again.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { organizationFixture } from "./organizations.test-helpers";
import { CLEANUP_MAX_ATTEMPTS, isMissingCleanup } from "./organizations";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "organization-cleanup-test-secret-at-least-32-characters");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
});
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const boss = await f.user("boss", { role: "admin" });
  const row = (organizationId: string) => t.run((ctx) => ctx.db.query("organizationCleanups")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).unique());
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return { ...f, boss, row, scheduled };
}

describe("organization cleanup", () => {
  test("errors are retried with backoff, then the cleanup stops as failed until an administrator retries it", async () => {
    const f = await fixture();
    const organizationId = "org-under-cleanup";
    // Each run carries the row's run token; a retry starts a new one.
    const record = async (outcome: "progress" | "error" | "done") =>
      f.t.mutation(internal.platform.organizations.recordCleanup, { organizationId, runId: (await f.row(organizationId))?.runId, batches: 1, outcome, error: outcome === "error" ? "transient" : undefined });

    expect(await f.t.mutation(internal.platform.organizations.beginCleanup, { organizationId })).toBe(true);
    await record("progress");
    expect(await f.row(organizationId)).toMatchObject({ state: "running", batches: 1, attempts: 0 });

    for (let attempt = 1; attempt < CLEANUP_MAX_ATTEMPTS; attempt++) {
      await record("error");
      expect(await f.row(organizationId)).toMatchObject({ state: "running", attempts: attempt, lastError: "transient" });
    }
    const before = (await f.scheduled()).length;
    await record("error");
    expect(await f.row(organizationId)).toMatchObject({ state: "failed", attempts: CLEANUP_MAX_ATTEMPTS });
    expect((await f.scheduled()).length).toBe(before);
    // A late or duplicate run of a failed cleanup does nothing.
    expect(await f.t.mutation(internal.platform.organizations.beginCleanup, { organizationId })).toBe(false);

    const listed = await f.boss.caller.query(api.platform.adminOrganizations.cleanups, {});
    expect(listed).toMatchObject([{ organizationId, state: "failed", attempts: CLEANUP_MAX_ATTEMPTS, lastError: "transient" }]);
    await f.boss.caller.mutation(api.platform.adminOrganizations.retryCleanup, { organizationId });
    expect(await f.row(organizationId)).toMatchObject({ state: "running", attempts: 0 });
    await expect(f.boss.caller.mutation(api.platform.adminOrganizations.retryCleanup, { organizationId })).rejects.toThrow("CLEANUP_NOT_FAILED");

    await record("done");
    expect(await f.row(organizationId)).toMatchObject({ state: "done", batches: 2 + CLEANUP_MAX_ATTEMPTS });
    expect(await f.t.mutation(internal.platform.organizations.beginCleanup, { organizationId })).toBe(false);
    expect(await f.boss.caller.query(api.platform.adminOrganizations.cleanups, {})).toEqual([]);
  });

  test("only an unresolvable cleanup function counts as an app without cleanup", () => {
    expect(isMissingCleanup(new Error("Couldn't resolve organizationData:deleteOrganizationData"))).toBe(true);
    expect(isMissingCleanup(new Error("Could not find public function for 'organizationData:deleteOrganizationData'"))).toBe(true);
    // A lookup failing inside the app's cleanup is an error to retry, not missing cleanup.
    expect(isMissingCleanup(new Error("Could not find module for: \"files\""))).toBe(false);
    expect(isMissingCleanup("Could not find")).toBe(false);
  });

  test("cleanups are for administrators only", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    await expect(alice.caller.query(api.platform.adminOrganizations.cleanups, {})).rejects.toThrow("NOT_ADMIN");
    await expect(alice.caller.mutation(api.platform.adminOrganizations.retryCleanup, { organizationId: "x" })).rejects.toThrow();
  });
});
