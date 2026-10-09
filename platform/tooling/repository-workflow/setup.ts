import { run, type Run } from "../deploy-setup/io.ts";
import { discoverChecks, pages, request } from "./github.ts";
import { inspectRepositoryWorkflow } from "./inspect.ts";
import { expectedChecks, readRecord, saveRecord } from "./state.ts";
import type { MaintenanceBot, RepositoryWorkflowStatus, WorkflowRecord } from "./types.ts";

export type SetupOptions = {
  consent: boolean; approvals?: number; dismissStaleReviews?: boolean; discoverPr?: number;
  e2e?: "always" | "on-demand" | "off"; disableAutoMerge?: boolean; maintenanceBots?: MaintenanceBot[];
};
type SetupRule = { type: string; parameters?: Record<string, unknown> };
type ManagedRuleset = { id: number; name: string; target: string; enforcement: string; bypass_actors: unknown[];
  conditions: { ref_name: { include: string[]; exclude: string[] } }; rules: SetupRule[] };
const NAME = "Platform PR workflow (repository setup)";

/** Owner consent is required even when invoked through deploy setup. No credentials/callers are changed. */
export async function setupRepositoryWorkflow(root: string, repo: string, options: SetupOptions, exec: Run = run): Promise<RepositoryWorkflowStatus> {
  if (!options.consent) throw Error("Repository workflow settings require explicit owner consent; inspect with --check first, then use --yes.");
  const old = readRecord(root, repo);
  const approvals = options.approvals ?? old?.approvals;
  const dismiss = options.dismissStaleReviews ?? old?.dismissStaleReviews;
  if (!Number.isInteger(approvals) || approvals! < 0 || approvals! > 6 || typeof dismiss !== "boolean") throw Error("The owner must choose --approvals 0..6 and --dismiss-stale-reviews or --keep-stale-reviews before setup.");
  const record: WorkflowRecord = { ...(old ?? {}), schemaVersion: 1, repository: repo, approvals: approvals!, dismissStaleReviews: dismiss,
    maintenanceBots: options.maintenanceBots ?? old?.maintenanceBots ?? [] };
  const metadata = await request<{ default_branch: string; private: boolean; permissions?: { admin?: boolean }; allow_auto_merge?: boolean }>(`repos/${repo}`, exec);
  if (!metadata.permissions?.admin || !metadata.default_branch || typeof metadata.private !== "boolean") throw Error("Repository administration and verified default-branch identity are required for owner-consented setup.");
  const labels = expectedChecks(root, metadata.private);
  record.discovery = await discoverChecks(repo, metadata.default_branch, labels, exec, options.discoverPr ?? old?.discovery?.pr);
  saveRecord(root, record);
  const before = await inspectRepositoryWorkflow(root, repo, exec);
  if (before.protectionAvailability === "unknown" || before.defaultBranchExists === null
    || before.checks.some(c => c.status === "unavailable")) throw Error("Repository enforcement access is uncertain; no live settings were changed. Repair credentials and resume --check.");
  if (before.checks.find(c => c.step === "ruleset-merge-methods")?.status === "missing") throw Error("Existing ruleset merge policy conflicts with squash; preserve it and ask the owner to resolve the policy before setup.");
  const settings: Record<string, unknown> = { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true };
  if (options.disableAutoMerge || metadata.allow_auto_merge === false) settings.allow_auto_merge = false;
  // An existing owner's auto-merge intent is never silently disabled, or enabled on a new repo.
  const discovered = record.discovery;
  let enforcementWrite: { endpoint: string; method: string; body: unknown } | undefined;
  const desired: SetupRule[] = [
    { type: "pull_request", parameters: { required_approving_review_count: Math.max(approvals!, before.effective.approvals), dismiss_stale_reviews_on_push: dismiss || before.effective.dismissStaleReviews,
      require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false, allowed_merge_methods: ["squash"] } },
    { type: "required_linear_history" }, { type: "non_fast_forward" }, { type: "deletion" },
    { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true,
      required_status_checks: (discovered?.checks ?? []).map(c => ({ context: c.context, integration_id: c.appId })) } },
  ];
  // Existing classic protection and inherited rules remain untouched. The supplement closes gaps.
  if (before.protectionAvailability === "available" && before.defaultBranchExists && discovered
    && labels.every(label => discovered.checks.some(c => c.label === label))
    && !before.checks.filter(c => ["pull-request", "linear-history", "strict-updates", "admins-and-bypass", "approval-policy", "required-checks"].includes(c.step)).every(c => c.status === "done")) {
    const candidates = (await pages<{ id: number; name: string; source_type: string; source: string }>(`repos/${repo}/rulesets?includes_parents=false`, exec)).filter(r => r.name === NAME);
    if (candidates.length > 1) throw Error("Multiple repository workflow setup rulesets exist; review them before resuming.");
    let current: ManagedRuleset | undefined;
    if (candidates[0]) {
      current = await request<ManagedRuleset>(`repos/${repo}/rulesets/${candidates[0].id}`, exec);
      if (current.target !== "branch" || !Array.isArray(current.rules) || !Array.isArray(current.bypass_actors) || current.bypass_actors.length
        || current.conditions?.ref_name?.include?.length !== 1 || current.conditions.ref_name.include[0] !== "~DEFAULT_BRANCH" || current.conditions.ref_name.exclude?.length) throw Error("Existing named setup ruleset has custom scope or bypass authority; preserve it and review manually.");
    }
    const rules = [...(current?.rules ?? [])];
    for (const rule of desired) {
      const index = rules.findIndex(r => r.type === rule.type);
      if (index < 0) { rules.push(rule); continue; }
      if (rule.type === "pull_request") {
        const oldParameters = rules[index].parameters ?? {};
        rules[index] = { type: rule.type, parameters: { ...rule.parameters, ...oldParameters,
          required_approving_review_count: Math.max(Number(oldParameters.required_approving_review_count ?? 0), Number(rule.parameters!.required_approving_review_count)),
          dismiss_stale_reviews_on_push: oldParameters.dismiss_stale_reviews_on_push === true || rule.parameters!.dismiss_stale_reviews_on_push === true } };
      } else if (rule.type === "required_status_checks") {
        const oldChecks = rules[index].parameters?.required_status_checks as { context: string; integration_id?: number }[] | undefined;
        if (oldChecks !== undefined && !Array.isArray(oldChecks)) throw Error("Invalid existing ruleset checks; preserve and review manually.");
        const checks = [...(oldChecks ?? [])];
        for (const c of discovered.checks) {
          const existing = checks.find(p => p.context === c.context);
          if (existing?.integration_id && existing.integration_id !== c.appId) throw Error(`Existing publisher binding for ${c.context} differs; no check binding was replaced.`);
          if (!existing) checks.push({ context: c.context, integration_id: c.appId });
          else if (!existing.integration_id) existing.integration_id = c.appId;
        }
        rules[index] = { type: rule.type, parameters: { ...rules[index].parameters, strict_required_status_checks_policy: true, required_status_checks: checks } };
      }
    }
    const body = { name: NAME, target: "branch", enforcement: "active", bypass_actors: [], conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } }, rules };
    enforcementWrite = { endpoint: `repos/${repo}/rulesets${current ? "/" + current.id : ""}`, method: current ? "PUT" : "POST", body };
  }
  // Finish all authority/scope/conflict reads before the first live permission/settings write.
  await request(`repos/${repo}`, exec, "PATCH", settings);
  if (options.e2e) {
    await exec("gh", ["variable", "set", "PLATFORM_CI_PR_E2E", "--repo", repo, "--body", options.e2e]);
    if (options.e2e === "on-demand") await exec("gh", ["label", "create", "run-e2e", "--repo", repo, "--color", "0E8A16", "--description", "Run E2E on this PR", "--force"]);
  }
  if (enforcementWrite) await request(enforcementWrite.endpoint, exec, enforcementWrite.method, enforcementWrite.body);
  return inspectRepositoryWorkflow(root, repo, exec);
}
