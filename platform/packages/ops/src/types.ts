export type Environment = "staging" | "production";
export interface Config {
  repository: string;
  workflowRef: string;
  teamId?: string;
  // null means intentionally not tracked; an absent key is missing configuration.
  apps: Record<string, { projects: Partial<Record<Environment, { id: string; domain?: string | null } | null>> }>;
}
export interface Run {
  id: number; name: string; display_title: string; path: string; head_sha: string;
  head_branch: string; status: string; conclusion: string | null; run_attempt: number;
  html_url: string; created_at: string; updated_at: string; run_started_at?: string;
  actor: { login: string }; triggering_actor?: { login: string };
  event?: string;
}
export interface Job {
  id: number; name: string; status: string; conclusion: string | null; html_url: string;
  started_at: string | null; completed_at: string | null;
  steps: { name: string; status: string; conclusion: string | null; number: number }[];
}
export interface Artifact {
  id: number; name: string; created_at: string; expires_at: string; expired: boolean;
  size_in_bytes: number; digest?: string; workflow_run?: { id: number; head_sha: string };
}
export interface RecordPayload {
  schemaVersion: 1; app: string; environment: Environment; selectedSha: string;
  builtSha?: string; inputHash?: string; artifactId?: number; artifactName?: string;
  checksum?: string; buildRunId?: number; reused?: boolean; result: string; buildResult?: string;
  health: string; runId: number; runAttempt: number; actor: string; recordedAt: string;
  deploymentUrl?: string; requestId?: string; operation: string;
}
export interface Deployment {
  id: number; sha: string; environment: string; created_at: string; task: string;
  payload: Partial<RecordPayload>; creator?: { login: string };
}
export interface VercelDeployment {
  uid?: string; id?: string; url: string; state?: string; readyState?: string;
  createdAt?: number; created?: number; ready?: number; meta?: Record<string, string>;
}
export interface Alias { alias: string; deploymentId: string; projectId?: string }
export interface Commit { sha: string; commit: { message: string; author: { date: string } }; html_url: string }
export interface Result { rows?: Record<string, unknown>[]; [key: string]: unknown }
export interface Coverage {
  source: string; state: "complete" | "windowed" | "partial" | "unavailable";
  count: number; limit?: number;
}
export type PageReport = (coverage: Coverage, error?: unknown) => void;
export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  pages<T>(path: string, key?: string, limit?: number, report?: PageReport): Promise<T[]>;
}
