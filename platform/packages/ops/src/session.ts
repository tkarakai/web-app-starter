import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fullSha } from "./evidence";
import { OpsError } from "./errors";
import type { Environment } from "./types";

export interface Operation {
  repository: string; environment: Environment; sha: string; workflow: string; workflowRef: string;
  requestId: string; runId?: number; attempt?: number; startedAt: string;
  operation: "deploy" | "rollback"; accepted: boolean;
}
export function operation(value: unknown): Operation {
  if (!value || typeof value !== "object") throw new Error("Invalid session");
  const v = value as Operation;
  if (!/^[\w.-]+\/[\w.-]+$/.test(v.repository) || !["staging", "production"].includes(v.environment) || !fullSha(v.sha)
    || !/^cd-(staging|production|rollback)\.yml$/.test(v.workflow) || typeof v.workflowRef !== "string" || !v.workflowRef
    || !/^[a-zA-Z0-9-]{1,100}$/.test(v.requestId) || !Number.isFinite(Date.parse(v.startedAt))
    || !["deploy", "rollback"].includes(v.operation) || typeof v.accepted !== "boolean"
    || (v.runId !== undefined && (!Number.isSafeInteger(v.runId) || v.runId < 1))
    || (v.attempt !== undefined && (!Number.isSafeInteger(v.attempt) || v.attempt < 1))) throw new Error("Invalid session");
  return { repository: v.repository, environment: v.environment, sha: v.sha, workflow: v.workflow, workflowRef: v.workflowRef,
    requestId: v.requestId, runId: v.runId, attempt: v.attempt, startedAt: v.startedAt, operation: v.operation, accepted: v.accepted };
}
export function sessionStore(configPath = "ops.config.json") {
  const path = `${resolve(configPath)}.session.json`;
  return {
    async load(): Promise<Operation | undefined> {
      try {
        const text = await readFile(path, "utf8");
        if (text.length > 16_384) throw new Error("Oversized session");
        return operation(JSON.parse(text));
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return undefined;
        throw new OpsError("SESSION", "Cannot read the saved operations session.", `Inspect or remove ${path}; current operations can still be opened by run ID.`, 2);
      }
    },
    async save(value: Operation) {
      const temporary = `${path}.${crypto.randomUUID()}.tmp`;
      try { await writeFile(temporary, `${JSON.stringify(operation(value), null, 2)}\n`, { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
      finally { await unlink(temporary).catch(() => {}); }
    },
  };
}
