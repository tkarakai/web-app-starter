export type RequiredCheck = { label: string; context: string; appId: number };
export type MaintenanceBot = { login: string; appId: number; kind: "platform-update"; policy: "patch" | "minor" };
export type WorkflowRecord = {
  schemaVersion: 1; repository: string; approvals: number; dismissStaleReviews: boolean;
  maintenanceBots: MaintenanceBot[];
  discovery?: { pr: number; sha: string; checks: RequiredCheck[] };
};
export type WorkflowCheck = {
  step: string; status: "done" | "missing" | "unavailable" | "policy-only";
  enforceable: boolean | null; detail: string;
};
export type EffectivePolicy = {
  pullRequestRequired: boolean; linearHistory: boolean; strict: boolean; approvals: number;
  dismissStaleReviews: boolean; adminsEnforced: boolean; bypassActors: unknown[];
  requiredChecks: { context: string; appId: number | null }[];
};
export type RepositoryWorkflowStatus = {
  repository: string; checkedAt: string; readiness: "enforced" | "policy-only" | "incomplete";
  defaultBranch: string | null; defaultBranchExists: boolean | null; private: boolean | null;
  protectionAvailability: "available" | "unsupported-private-free" | "unknown";
  checks: WorkflowCheck[]; reasons: string[]; expectedChecks: string[];
  discovery: WorkflowRecord["discovery"] | null;
  effective: EffectivePolicy; e2e: { mode: string | null; enforced: boolean };
  autoMerge: boolean | null; featureAutoMergeAllowed: false;
  autoMergeCheckReason: string;
  maintenanceBots: (MaintenanceBot & { verified: boolean; reason: string })[];
  deploymentGate: { preventsDirectPushes: false; detail: string };
};
export type Protection = {
  required_status_checks?: { strict?: boolean; contexts?: string[]; checks?: { context: string; app_id: number | null }[] };
  enforce_admins?: { enabled?: boolean };
  required_pull_request_reviews?: {
    required_approving_review_count?: number; dismiss_stale_reviews?: boolean;
    bypass_pull_request_allowances?: { users?: unknown[]; teams?: unknown[]; apps?: unknown[] };
    [key: string]: unknown;
  };
  required_linear_history?: { enabled?: boolean };
  allow_force_pushes?: { enabled?: boolean }; allow_deletions?: { enabled?: boolean };
};
export type Rule = {
  type: string; ruleset_id: number; ruleset_source_type: string; ruleset_source: string;
  parameters?: { required_approving_review_count?: number; dismiss_stale_reviews_on_push?: boolean;
    strict_required_status_checks_policy?: boolean;
    required_status_checks?: { context: string; integration_id?: number | null }[];
    [key: string]: unknown };
};
export type Ruleset = { id: number; enforcement: string; bypass_actors?: unknown[] };
