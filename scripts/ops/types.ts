/** Provider wire shapes. Only these fields may enter normalized evidence. */
export type Environment = "staging" | "production";
export interface Config {
  repo: string;
  apps: string[];
  projects: Record<string, Partial<Record<Environment, string>>>;
  team_id?: string;
}
export interface Coverage {
  source: string;
  state: "complete" | "windowed" | "partial" | "unavailable";
  detail: string;
}
export interface Tag {
  name: string;
  sha: string;
  time: string;
  run_id: number | null;
}
export interface GitObject {
  type: string;
  sha: string;
}
export interface Ref {
  ref: string;
  object: GitObject;
}
export interface TagObject {
  object: GitObject;
  message?: string;
}
export interface Run {
  id: number;
  path?: string;
  event?: string;
  head_sha?: string;
  created_at?: string;
  updated_at?: string;
  conclusion?: string | null;
  status?: string;
  run_attempt?: number;
}
export interface Step {
  name: string;
  conclusion?: string | null;
  started_at?: string;
  completed_at?: string;
}
export interface Job extends Step {
  id: number;
  run_id: number;
  status?: string;
  html_url?: string;
  steps?: Step[];
}
export interface Artifact {
  id: number;
  name: string;
  created_at?: string;
  expires_at?: string;
  expired?: boolean;
  workflow_run?: { id?: number; head_sha?: string };
}
export interface DeploymentStatus {
  id?: number;
  state?: string;
  created_at?: string;
  log_url?: string;
  environment_url?: string;
}
export interface GitHubDeployment {
  id: number;
  sha?: string;
  environment?: string;
  created_at?: string;
  statuses: DeploymentStatus[];
}
export interface VercelDeployment {
  uid?: string;
  id?: string;
  createdAt?: number;
  created?: number;
  ready?: number;
  readyAt?: number;
  readyState?: string;
  state?: string;
  url?: string | null;
  meta?: Record<string, string>;
}
export interface VercelRow {
  app: string;
  environment: Environment;
  project: string;
  deployment: VercelDeployment;
  current: boolean | null;
}
export interface Gate {
  state: string;
  target_url?: string;
  updated_at?: string;
}
export interface Snapshot {
  repo: string;
  gathered_at: string;
  tags: Tag[];
  runs: Run[];
  jobs: Job[];
  artifacts: Artifact[];
  deployments: GitHubDeployment[];
  vercel: VercelRow[];
  gates: Record<string, Gate>;
  coverage: Coverage[];
}
export type Kind =
  | "workflow"
  | "ci-build"
  | "deploy-job"
  | "build-resolve"
  | "artifact"
  | "deploy-tag"
  | "release-tag"
  | "vercel"
  | "github-deployment";
export interface Evidence {
  id: string;
  kind: Kind;
  app: string | null;
  sha: string | null;
  environment: string | null;
  time: string;
  state: string;
  source: string;
  url: string;
  updated_at: string;
  context_sha: string | null;
  name: string;
  input_hash: string | null;
  expires_at: string;
  current: boolean | null;
  notes: string[];
  related: string[];
}
export interface CandidateArtifact {
  name: string;
  state: string;
  url: string;
  uploaded_at: string;
  expires_at: string;
  input_hash: string | null;
}
export interface Candidate {
  sha: string;
  classification: string;
  reasons: string[];
  staging: string[];
  production: string[];
  gate_url: string;
  artifacts: Record<string, CandidateArtifact[]>;
  release_tags: string[];
  limitations: string[];
}
export const fullSha = (value: unknown): string | null =>
  typeof value === "string" && /^[a-f\d]{40}$/i.test(value)
    ? value.toLowerCase()
    : null;
export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";
