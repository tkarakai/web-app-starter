/**
 * The cleanup of a deleted organization's app data as a tracked background job
 * (backgroundJobs.ts): its `organizationCleanups` row is written, with the scheduled run's ID and
 * a run token, in the transaction that deletes the organization. The runs are
 * `organizations.deleteOrganizationAppData`.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { jobStale, newRunId } from "./backgroundJobs";

export type CleanupRow = Doc<"organizationCleanups">;

export async function cleanupRow(ctx: Pick<QueryCtx, "db">, organizationId: string): Promise<CleanupRow | null> {
  return await ctx.db.query("organizationCleanups").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).unique();
}

/** Schedule the next run of the row's chain and record its job, in the caller's transaction. */
export async function scheduleCleanupRun(ctx: Pick<MutationCtx, "db" | "scheduler">, row: CleanupRow, delayMs: number, patch: Partial<CleanupRow> = {}) {
  const runId = patch.runId ?? row.runId;
  const jobId = await ctx.scheduler.runAfter(delayMs, internal.platform.organizations.deleteOrganizationAppData, { organizationId: row.organizationId, runId });
  await ctx.db.patch(row._id, { ...patch, jobId });
}

/**
 * Record that a deleted organization's app data is owed a cleanup, and schedule it, in the
 * transaction that deletes the organization: every deletion path calls this, so the owed cleanup
 * is recorded even if its first run never starts. Idempotent: a recorded cleanup is left alone.
 */
export async function startOrganizationCleanup(ctx: Pick<MutationCtx, "db" | "scheduler">, organizationId: string): Promise<void> {
  if (await cleanupRow(ctx, organizationId)) return;
  const now = Date.now();
  const id = await ctx.db.insert("organizationCleanups", { organizationId, state: "running", attempts: 0, batches: 0, startedAt: now, updatedAt: now, runId: newRunId() });
  await scheduleCleanupRun(ctx, (await ctx.db.get(id))!, 0);
}

/** Whether a `running` cleanup is stuck: its run died without recording an outcome (backgroundJobs.ts). */
export async function cleanupStale(ctx: Pick<QueryCtx, "db">, row: CleanupRow, now = Date.now()): Promise<boolean> {
  return row.state === "running" && await jobStale(ctx, row, row.updatedAt, now);
}

/** An administrator's retry of a failed or stale cleanup: a new chain from where it stopped (batches are idempotent). */
export async function restartCleanup(ctx: Pick<MutationCtx, "db" | "scheduler">, row: CleanupRow): Promise<void> {
  await scheduleCleanupRun(ctx, row, 0, { state: "running", attempts: 0, updatedAt: Date.now(), runId: newRunId() });
}
