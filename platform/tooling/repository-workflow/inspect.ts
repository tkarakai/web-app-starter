import { run, type Run } from "../deploy-setup/io.ts";
import { discoverChecks, pages, request, statusCode } from "./github.ts";
import { expectedChecks, readRecord, RECORD, validateRecord } from "./state.ts";
import type { EffectivePolicy, MaintenanceBot, Protection, RepositoryWorkflowStatus, Rule, Ruleset, WorkflowRecord } from "./types.ts";

type Metadata = { full_name: string; default_branch: string; private: boolean; allow_squash_merge: boolean;
  allow_merge_commit: boolean; allow_rebase_merge: boolean; delete_branch_on_merge: boolean; allow_auto_merge: boolean;
  owner: { login: string; type: string }; permissions?: { admin?: boolean } };
function emptyEffective(): EffectivePolicy {
  return { pullRequestRequired: false, linearHistory: false, strict: false, approvals: 0,
    dismissStaleReviews: false, adminsEnforced: false, bypassActors: [], requiredChecks: [] };
}
function classicBypasses(protection: Protection): unknown[] {
  const b = protection.required_pull_request_reviews?.bypass_pull_request_allowances;
  return [...(b?.users ?? []), ...(b?.teams ?? []), ...(b?.apps ?? [])];
}
export function effectivePolicy(protection: Protection | undefined, rules: Rule[], details: Ruleset[]): EffectivePolicy {
  const result = emptyEffective();
  if (protection) {
    const bypasses = classicBypasses(protection);
    result.bypassActors.push(...bypasses);
    if (protection.enforce_admins?.enabled === true && bypasses.length === 0) {
      result.adminsEnforced = true;
      result.pullRequestRequired = Boolean(protection.required_pull_request_reviews);
      result.linearHistory = protection.required_linear_history?.enabled === true;
      result.strict = protection.required_status_checks?.strict === true;
      result.approvals = protection.required_pull_request_reviews?.required_approving_review_count ?? 0;
      result.dismissStaleReviews = protection.required_pull_request_reviews?.dismiss_stale_reviews === true;
      // contexts alone carry no publisher binding, and therefore cannot prove the required app checks.
      result.requiredChecks.push(...(protection.required_status_checks?.checks ?? []).map(c => ({ context: c.context, appId: c.app_id })));
    }
  }
  for (const detail of details) {
    if (detail.enforcement !== "active") continue;
    result.bypassActors.push(...(detail.bypass_actors ?? []));
    if (!Array.isArray(detail.bypass_actors) || detail.bypass_actors.length) continue;
    const applicable = rules.filter(r => r.ruleset_id === detail.id);
    if (applicable.length) result.adminsEnforced = true;
    for (const rule of applicable) {
      if (rule.type === "required_linear_history") result.linearHistory = true;
      if (rule.type === "pull_request") {
        result.pullRequestRequired = true;
        result.approvals = Math.max(result.approvals, rule.parameters?.required_approving_review_count ?? 0);
        result.dismissStaleReviews ||= rule.parameters?.dismiss_stale_reviews_on_push === true;
      }
      if (rule.type === "required_status_checks") {
        result.strict ||= rule.parameters?.strict_required_status_checks_policy === true;
        result.requiredChecks.push(...(rule.parameters?.required_status_checks ?? []).map(c => ({ context: c.context, appId: c.integration_id ?? null })));
      }
    }
  }
  return result;
}
async function privateFree(metadata: Metadata, exec: Run): Promise<boolean> {
  if (!metadata.private) return false;
  const owner = metadata.owner;
  const account = await request<{ login: string; plan?: { name: string } }>(owner.type === "Organization" ? `orgs/${owner.login}` : "user", exec);
  return account.login?.toLowerCase() === owner.login.toLowerCase() && account.plan?.name === "free";
}
async function verifyBot(bot: MaintenanceBot, repo: string, sha: string | undefined, effective: EffectivePolicy, exec: Run): Promise<void> {
  if (!sha) throw Error("Default branch commit could not be verified");
  const policy = await request<{ encoding: string; content: string }>(`repos/${repo}/contents/${RECORD}?ref=${sha}`, exec);
  if (policy.encoding !== "base64" || typeof policy.content !== "string") throw Error("Could not inspect the committed owner policy");
  const committed = validateRecord(JSON.parse(Buffer.from(policy.content, "base64").toString("utf8")));
  if (committed.repository.toLowerCase() !== repo.toLowerCase() || !committed.maintenanceBots.some(grant =>
    grant.login === bot.login && grant.appId === bot.appId && grant.kind === bot.kind && grant.policy === bot.policy)) {
    throw Error("The committed owner policy does not grant this exact maintenance authority");
  }
  if (effective.approvals < committed.approvals || committed.dismissStaleReviews && !effective.dismissStaleReviews) {
    throw Error("Live review enforcement does not meet the committed maintenance policy");
  }
  const slug = bot.login.replace(/\[bot\]$/, "");
  const app = await request<{ id: number; slug: string; permissions: Record<string, string> }>(`apps/${slug}`, exec);
  const allowed = { contents: "write", pull_requests: "write", workflows: "write", issues: "write", metadata: "read", administration: "read", checks: "read", variables: "read" };
  if (app.id !== bot.appId || app.slug !== slug || !app.permissions
    || Object.entries(app.permissions).some(([key, value]) => allowed[key as keyof typeof allowed] !== value)
    || app.permissions.contents !== "write" || app.permissions.pull_requests !== "write"
    || ["administration", "checks", "variables"].some(scope => app.permissions[scope] !== "read")) throw Error("Bot App identity or narrow read-only enforcement inspection permissions differ");
  const variables = await request<{ total_count: number; variables: { name: string; value: string }[] }>(`repos/${repo}/actions/variables?per_page=100`, exec);
  if (!Array.isArray(variables.variables) || variables.total_count > variables.variables.length) throw Error("Could not completely inspect maintenance variables");
  const variable = (name: string) => variables.variables.find(v => v.name === name)?.value;
  if (variable("PLATFORM_UPDATER_APP_ID") !== String(bot.appId) || variable("PLATFORM_UPDATE_DELIVERY") !== "app") throw Error("Named updater App delivery is not active");
  const caller = await request<{ encoding: string; content: string }>(`repos/${repo}/contents/.github/workflows/update-platform.yml?ref=${sha}`, exec);
  if (caller.encoding !== "base64" || typeof caller.content !== "string") throw Error("Could not inspect the committed maintenance caller");
  const source = Buffer.from(caller.content, "base64").toString("utf8");
  // Parse data on stdin; caller text is never executed, and harmless YAML formatting stays supported.
  const parsed = JSON.parse(await exec("bun", ["-e", "process.stdout.write(JSON.stringify(Bun.YAML.parse(await Bun.stdin.text())))"], source)) as { jobs?: Record<string, { uses?: unknown; with?: Record<string, unknown>; steps?: unknown }> };
  const jobs = Object.values(parsed?.jobs ?? {});
  const updater = jobs.filter(j => j.uses === "./.github/workflows/platform-update.yml");
  if (jobs.length !== 1 || updater.length !== 1 || updater[0].steps !== undefined || updater[0].with?.policy !== bot.policy || updater[0].with?.["auto-merge"] !== true) throw Error("Committed updater caller is not mechanically constrained to the named patch/minor policy");
  // A saved credential name is not authentication. The active CLI must prove an installation token
  // and its bot identity; owner PATs and unknown/stale stored keys fail closed.
  const installation = await request<{ total_count: number; repositories: { full_name: string }[] }>("installation/repositories?per_page=100", exec);
  const viewer = await request<{ data?: { viewer?: { login?: string } } }>("graphql", exec, "POST", { query: "query { viewer { login } }" });
  if (installation.total_count !== 1 || installation.repositories?.length !== 1 || installation.repositories[0].full_name.toLowerCase() !== repo.toLowerCase()
    || viewer.data?.viewer?.login !== bot.login) throw Error("Active credential is not the named repository-only App installation");
}

/** Read actual GitHub enforcement. Local intent and workflow presence never count as live evidence. */
export async function inspectRepositoryWorkflow(root: string, repo: string, exec: Run = run): Promise<RepositoryWorkflowStatus> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error("Select a GitHub repository as owner/repo");
  const status: RepositoryWorkflowStatus = {
    repository: repo, checkedAt: new Date().toISOString(), readiness: "incomplete", defaultBranch: null, defaultBranchExists: null,
    private: null, protectionAvailability: "unknown", checks: [], reasons: [], expectedChecks: [], discovery: null,
    effective: emptyEffective(), e2e: { mode: null, enforced: false }, autoMerge: null, featureAutoMergeAllowed: false, maintenanceBots: [],
    autoMergeCheckReason: "Auto-merge permission is unverified; feature/bootstrap PRs require an owner or independent reviewer.",
    deploymentGate: { preventsDirectPushes: false, detail: "Deployment verifies the selected commit with E2E; it does not prevent direct pushes or unsafe merges." },
  };
  const add = (step: string, done: boolean, detail: string, enforceable: boolean | null = true) => {
    status.checks.push({ step, status: done ? "done" : "missing", enforceable, detail });
    if (!done) status.reasons.push(detail);
  };
  const unavailable = (step: string, detail: string) => { status.checks.push({ step, status: "unavailable", enforceable: null, detail }); status.reasons.push(detail); };
  let record: WorkflowRecord | undefined;
  try { record = readRecord(root, repo); } catch { unavailable("owner-policy", "Repository workflow policy is invalid or belongs to another repository; review it before setup."); }
  let metadata: Metadata;
  try {
    metadata = await request<Metadata>(`repos/${repo}`, exec);
    if (metadata.full_name?.toLowerCase() !== repo.toLowerCase() || !metadata.default_branch || typeof metadata.private !== "boolean" || !metadata.owner?.login) throw Error("Invalid repository metadata");
    status.defaultBranch = metadata.default_branch; status.private = metadata.private;
    status.expectedChecks = expectedChecks(root, metadata.private);
  } catch { unavailable("repository", "Repository metadata is unavailable; sign in with repository access and re-check."); return status; }
  const branch = encodeURIComponent(metadata.default_branch);
  let defaultBranchSha: string | undefined;
  try {
    const live = await request<{ name: string; commit: { sha: string } }>(`repos/${repo}/branches/${branch}`, exec);
    if (live.name !== metadata.default_branch || !/^[a-f0-9]{40}$/.test(live.commit?.sha)) throw Error("Invalid default branch response");
    defaultBranchSha = live.commit.sha;
    status.defaultBranchExists = true; add("default-branch", true, `Default branch is ${metadata.default_branch}.`);
  } catch (error) {
    if (statusCode(error) === 404) { status.defaultBranchExists = false; add("default-branch", false, "Default branch does not exist; create only the minimal owner-authorized bootstrap commit, then open a draft adoption PR."); }
    else unavailable("default-branch", "Default branch could not be verified.");
  }
  add("merge-methods", metadata.allow_squash_merge === true && metadata.allow_merge_commit === false && metadata.allow_rebase_merge === false, "Squash must be the sole repository merge method.");
  add("delete-head-branch", metadata.delete_branch_on_merge === true, "Automatic head-branch deletion must be enabled.");
  let protection: Protection | undefined, protectionError: unknown, rulesError: unknown;
  let rules: Rule[] = [], details: Ruleset[] = [];
  try {
    protection = await request<Protection>(`repos/${repo}/branches/${branch}/protection`, exec);
    if (!protection || typeof protection !== "object" || Array.isArray(protection)) throw Error("Invalid branch protection response");
    const reviews = protection.required_pull_request_reviews, required = protection.required_status_checks;
    if (reviews && (!Number.isInteger(reviews.required_approving_review_count) || typeof reviews.dismiss_stale_reviews !== "boolean")) throw Error("Invalid review policy response");
    if (required && (typeof required.strict !== "boolean" || !Array.isArray(required.contexts) || required.checks !== undefined && !Array.isArray(required.checks))) throw Error("Invalid required checks response");
    for (const c of required?.checks ?? []) if (!c.context || c.app_id !== null && (!Number.isSafeInteger(c.app_id) || c.app_id < 1)) throw Error("Invalid check publisher binding");
  } catch (error) { protectionError = error; }
  try {
    rules = await pages<Rule>(`repos/${repo}/rules/branches/${branch}`, exec);
    for (const r of rules) {
      if (!r.type || !Number.isSafeInteger(r.ruleset_id) || !r.ruleset_source || !r.ruleset_source_type) throw Error("Invalid effective branch rules");
      if (r.type === "pull_request" && (!Number.isInteger(r.parameters?.required_approving_review_count) || typeof r.parameters?.dismiss_stale_reviews_on_push !== "boolean")) throw Error("Invalid effective PR policy");
      if (r.type === "required_status_checks" && (typeof r.parameters?.strict_required_status_checks_policy !== "boolean" || !Array.isArray(r.parameters?.required_status_checks))) throw Error("Invalid effective required checks");
    }
    for (const id of new Set(rules.map(r => r.ruleset_id))) {
      const rule = rules.find(r => r.ruleset_id === id)!;
      let endpoint: string;
      if (rule.ruleset_source_type === "Repository" && rule.ruleset_source.toLowerCase() === repo.toLowerCase()) endpoint = `repos/${repo}/rulesets/${id}`;
      else if (rule.ruleset_source_type === "Organization" && /^[\w.-]+$/.test(rule.ruleset_source)) endpoint = `orgs/${rule.ruleset_source}/rulesets/${id}`;
      else if (rule.ruleset_source_type === "Enterprise" && /^[\w.-]+$/.test(rule.ruleset_source)) endpoint = `enterprises/${rule.ruleset_source}/rulesets/${id}`;
      else throw Error("Effective inherited ruleset source cannot be inspected");
      const detail = await request<Ruleset>(endpoint, exec);
      if (detail.id !== id || detail.enforcement !== "active" || !Array.isArray(detail.bypass_actors)) throw Error("Active ruleset bypass authority is unavailable");
      details.push(detail);
    }
  } catch (error) { rulesError = error; }
  if (statusCode(protectionError) === 403 && statusCode(rulesError) === 403) {
    try { if (await privateFree(metadata, exec)) status.protectionAvailability = "unsupported-private-free"; } catch { /* Unreadable owner plan is credential uncertainty. */ }
  }
  if (status.protectionAvailability !== "unsupported-private-free") {
    if (rulesError) unavailable("effective-rulesets", "Active effective inherited rulesets or bypass actors could not be verified.");
    if (protectionError && statusCode(protectionError) !== 404) unavailable("classic-protection", "Classic branch protection could not be verified; a denial is not proof of a Free plan.");
    if (!rulesError && (!protectionError || statusCode(protectionError) === 404)) status.protectionAvailability = "available";
  }
  status.effective = effectivePolicy(protection, rules, details);
  add("ruleset-merge-methods", rules.every(r => r.type !== "pull_request" || r.parameters?.allowed_merge_methods === undefined
    || Array.isArray(r.parameters.allowed_merge_methods) && r.parameters.allowed_merge_methods.includes("squash"))
    && rules.every(r => r.type !== "merge_queue" || r.parameters?.merge_method === "SQUASH"), "Effective ruleset merge methods must permit squash and any merge queue must use squash.");
  add("pull-request", status.effective.pullRequestRequired, "Require a pull request before default-branch changes.");
  add("linear-history", status.effective.linearHistory, "Require linear default-branch history.");
  add("strict-updates", status.effective.strict, "Required checks must test the up-to-date branch.");
  add("admins-and-bypass", status.effective.adminsEnforced && status.effective.pullRequestRequired, "PR/check enforcement must cover administrators; unrestricted bypass layers cannot establish readiness.");
  add("approval-policy", Boolean(record) && status.effective.approvals >= (record?.approvals ?? 0)
    && (!record?.dismissStaleReviews || status.effective.dismissStaleReviews), "Choose the owner approval and stale-review policy; preserve stronger existing requirements.");
  try {
    status.discovery = await discoverChecks(repo, metadata.default_branch, status.expectedChecks, exec, record?.discovery?.pr) ?? null;
    add("first-pr-contexts", Boolean(status.discovery) && status.expectedChecks.every(label => status.discovery!.checks.some(c => c.label === label)), "Open the bootstrap PR as draft, run non-E2E checks, then resume with --discover-pr N to discover exact completion contexts.");
  } catch { unavailable("first-pr-contexts", "Exact first-PR completion contexts and publishers could not be verified."); }
  add("required-checks", Boolean(status.discovery) && status.expectedChecks.every(label => {
    const binding = status.discovery!.checks.find(c => c.label === label);
    return binding && status.effective.requiredChecks.some(c => c.context === binding.context && c.appId === binding.appId);
  }), "Require the discovered exact app completion and Security Complete contexts with their verified app bindings (plus CodeQL on public repositories).");
  try {
    const variables = await request<{ total_count: number; variables: { name: string; value: string }[] }>(`repos/${repo}/actions/variables?per_page=100`, exec);
    if (!Array.isArray(variables.variables) || !Number.isSafeInteger(variables.total_count) || variables.total_count > variables.variables.length) throw Error("Incomplete repository variables");
    status.e2e.mode = variables.variables.find(v => v.name === "PLATFORM_CI_PR_E2E")?.value ?? "always";
    const valid = ["always", "on-demand", "off"].includes(status.e2e.mode);
    status.e2e.enforced = valid && status.e2e.mode !== "off" && status.effective.strict && status.effective.pullRequestRequired && status.checks.find(c => c.step === "required-checks")?.status === "done";
    add("e2e-policy", valid, `PR E2E policy: ${status.e2e.mode}; ${status.e2e.mode === "off" ? "owner/reviewer must verify full local E2E before merge" : "draft skips E2E; ready/label process applies"}.`, status.e2e.enforced);
  } catch { unavailable("e2e-policy", "Live PR E2E policy is unavailable."); }
  for (const bot of record?.maintenanceBots ?? []) {
    try { await verifyBot(bot, repo, defaultBranchSha, status.effective, exec); status.maintenanceBots.push({ ...bot, verified: true, reason: "Committed owner grant and review requirements, patch/minor caller and repository-only GitHub App credential verified." }); }
    catch { status.maintenanceBots.push({ ...bot, verified: false, reason: "Committed owner grant and review requirements, bot identity, committed caller, narrow App permissions or active installation credential could not be verified." }); }
  }
  status.autoMerge = typeof metadata.allow_auto_merge === "boolean" ? metadata.allow_auto_merge : null;
  add("auto-merge-policy", status.autoMerge === false || status.autoMerge === true && status.maintenanceBots.length > 0 && status.maintenanceBots.every(b => b.verified), "Auto-merge stays off by default; feature/bootstrap authors require owner or independent-reviewer merge authority. Only verified named constrained App bots are eligible.");
  if (status.protectionAvailability === "unsupported-private-free") {
    for (const check of status.checks.filter(c => ["pull-request", "linear-history", "strict-updates", "admins-and-bypass", "approval-policy", "required-checks"].includes(c.step))) { check.status = "policy-only"; check.enforceable = false; }
    status.reasons.push("Private GitHub Free protection is positively identified as unsupported; documented policy and the deployment commit gate do not prevent direct pushes or unsafe merges.");
    if (!status.checks.some(c => c.status === "unavailable") && status.defaultBranchExists === true
      && status.checks.filter(c => ["merge-methods", "delete-head-branch", "e2e-policy", "auto-merge-policy"].includes(c.step)).every(c => c.status === "done")) status.readiness = "policy-only";
  } else if (status.protectionAvailability === "available" && status.checks.every(c => c.status === "done")) status.readiness = "enforced";
  status.autoMergeCheckReason = status.autoMerge === false ? "Repository auto-merge is disabled; feature/bootstrap PRs require owner or independent-reviewer merge."
    : status.maintenanceBots.some(b => maintenanceAllowed(status, b.login)) ? "Only the verified named patch/minor App bot is eligible; each publisher must verify the PR class and immutable candidate itself."
    : "Maintenance auto-merge is blocked: verified enforcement, stale-approval dismissal, E2E, no bypass authority and an authenticated named repository-only App are required.";
  return status;
}

/** This authorizes only the named bot class; feature/bootstrap PRs are never eligible. */
export function maintenanceAllowed(status: RepositoryWorkflowStatus, botLogin: string): boolean {
  return status.readiness === "enforced" && status.protectionAvailability === "available" && status.defaultBranchExists === true
    && status.autoMerge === true && status.e2e.mode !== "off" && status.e2e.enforced
    && status.effective.pullRequestRequired && status.effective.linearHistory && status.effective.strict && status.effective.adminsEnforced
    && status.effective.dismissStaleReviews && status.effective.bypassActors.length === 0
    && status.checks.every(c => c.status === "done") && status.expectedChecks.length > 0 && status.expectedChecks.every(label => {
      const c = status.discovery?.checks.find(binding => binding.label === label);
      return c && status.effective.requiredChecks.some(required => required.context === c.context && required.appId === c.appId);
    })
    && status.maintenanceBots.some(bot => bot.login === botLogin && bot.verified && bot.kind === "platform-update" && ["patch", "minor"].includes(bot.policy));
}
