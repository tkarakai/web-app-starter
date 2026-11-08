/**
 * Tracking a background job by its scheduler record (platform/docs/organizations.md, "Background
 * jobs"). A job's progress row stores the scheduled function's ID (`jobId`) and a run token
 * (`runId`) in the transaction that schedules it:
 *
 * - **Stale:** a row still in a running state whose job can no longer move it on (`jobStale`).
 *   Convex runs a scheduled action at most once and never retries it, so a driver killed before
 *   its last write leaves the row running with nothing scheduled. No lease timer or cron needed.
 * - **Run token:** every run passes `runId`, and does nothing unless it matches the row
 *   (`isCurrentRun`). A retry writes a new token, so a late run of the old chain is a no-op and
 *   two chains never run at once.
 */
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { TransactionLimits } from "convex/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** An action may run for 10 minutes; one in progress for longer than this is gone. */
export const JOB_STALE_AFTER_MS = 15 * 60 * 1000;

/** The fields a progress row adds to track its job. Both optional: rows from before tracking have neither. */
export const jobFields = {
  jobId: v.optional(v.id("_scheduled_functions")),
  runId: v.optional(v.string()),
};

export type TrackedJob = { jobId?: Id<"_scheduled_functions">; runId?: string };

/** A fresh run token for a new chain of runs (a start or a retry). */
export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Whether a run belongs to the row's current chain. Rows and runs from before tracking match each other. */
export function isCurrentRun(row: TrackedJob, runId: string | undefined): boolean {
  return (row.runId ?? undefined) === (runId ?? undefined);
}

/**
 * Whether a row still in a running state is stuck: its job is no longer pending or running
 * (finished without moving the row on, failed, canceled, or its record expired, after about 7
 * days), or has been in progress longer than `JOB_STALE_AFTER_MS`. `since` is when the row last
 * recorded progress; it bounds the in-progress time, and decides alone for rows without a job ID.
 */
export async function jobStale(ctx: Pick<QueryCtx, "db">, row: TrackedJob, since: number, now = Date.now()): Promise<boolean> {
  if (!row.jobId) return now - since > JOB_STALE_AFTER_MS;
  const job = await ctx.db.system.get(row.jobId);
  if (!job) return true;
  if (job.state.kind === "pending") return false;
  if (job.state.kind === "inProgress") return now - Math.max(since, job.scheduledTime) > JOB_STALE_AFTER_MS;
  return true;
}

/** How much of the transaction a job's batch may use: the rest records its failure. */
const BATCH_SHARE = 0.9;
const BATCH_LIMITS = ["bytesRead", "bytesWritten", "databaseQueries", "documentsRead", "documentsWritten", "functionsScheduled", "scheduledFunctionArgsBytes"] as const;

/**
 * Limits for a batch run as a sub-transaction (`ctx.runMutation(..., { transactionLimits })`):
 * most of what this transaction has left, so a batch that exceeds them fails and rolls back
 * while the driver still has room to record the failure. `undefined` where metrics aren't
 * available.
 */
export async function batchLimits(ctx: Pick<MutationCtx, "meta">): Promise<TransactionLimits | undefined> {
  try {
    const metrics = await ctx.meta.getTransactionMetrics();
    return Object.fromEntries(BATCH_LIMITS.map((key) => [key, Math.floor(metrics[key].remaining * BATCH_SHARE)]));
  } catch {
    return undefined;
  }
}
