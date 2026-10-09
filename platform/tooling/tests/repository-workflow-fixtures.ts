import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CommandError, run, type Run } from "../deploy-setup/io.ts";
import { expectedChecks, saveRecord } from "../repository-workflow/state.ts";
import type { Protection, Rule, Ruleset, WorkflowRecord } from "../repository-workflow/types.ts";

export function fixture(isPrivate = true) {
  const root = mkdtempSync(path.join(tmpdir(), "repository-workflow-"));
  for (const dir of ["apps/web", "platform/apps/admin", "apps/landing", "platform/apps/storybook"]) { mkdirSync(path.join(root, dir), { recursive: true }); writeFileSync(path.join(root, dir, "package.json"), "{}"); }
  const labels = expectedChecks(root, isPrivate);
  const bindings = labels.map(label => ({ label, context: label === "Security Complete" ? "Platform / Security Complete" : label, appId: 15368 }));
  const record: WorkflowRecord = { schemaVersion: 1, repository: "owner/app", approvals: 1, dismissStaleReviews: true, maintenanceBots: [], discovery: { pr: 1, sha: "a".repeat(40), checks: bindings } };
  saveRecord(root, record);
  const f = {
    root, record, bindings,
    metadata: { full_name: "owner/app", default_branch: "main", private: isPrivate, allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false,
      delete_branch_on_merge: true, allow_auto_merge: false, owner: { login: "owner", type: "User" }, permissions: { admin: true } },
    protection: { enforce_admins: { enabled: true }, required_linear_history: { enabled: true },
      required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true },
      required_status_checks: { strict: true, contexts: bindings.map(c => c.context), checks: bindings.map(c => ({ context: c.context, app_id: c.appId })) } } as Protection,
    protectionError: undefined as number | undefined, rulesError: undefined as number | undefined,
    plan: "free", branchExists: true, branchSha: "b".repeat(40), hasPr: true, discovered: bindings,
    rules: [] as Rule[], details: [] as Ruleset[], variableError: false, rulesetDetailError: false,
    variables: [] as { name: string; value: string }[],
    organizationVariables: [] as { name: string; value: string }[], organizationVariableError: undefined as number | undefined,
    variableResponses: {} as Record<string, unknown>,
    committedFiles: ["platform/apps/storybook/package.json", "apps/web/package.json", "platform/apps/admin/package.json", "apps/landing/package.json"],
    treeError: undefined as number | undefined, treeResponse: undefined as unknown,
    calls: [] as { file: string; args: string[]; input?: string }[],
    committedPolicy: JSON.stringify(record) as string | undefined, policyError: undefined as number | undefined,
    contentSha: "b".repeat(40), advanceBranchOnPolicyRead: false,
    caller: "jobs: {update: {uses: './.github/workflows/platform-update.yml', with: {policy: patch, auto-merge: true}}}",
    appPermissions: { contents: "write", pull_requests: "write", workflows: "write", issues: "write", metadata: "read", administration: "read", checks: "read", variables: "read" } as Record<string, string>,
    viewer: "app-updater[bot]", installationRepos: ["owner/app"], credentialError: false,
    managedRuleset: undefined as { id: number; name: string; target: string; enforcement: string; bypass_actors: unknown[]; conditions: unknown; rules: { type: string; parameters?: Record<string, unknown> }[] } | undefined,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
  const exec: Run = async (file, args, input, env, cwd) => {
    f.calls.push({ file, args, input });
    if (file !== "gh") return run(file, args, input, env, cwd);
    if (args[0] === "variable") { const name = args[args.indexOf("--body") + 1]; f.variables = [{ name: "PLATFORM_CI_PR_E2E", value: name }]; return ""; }
    if (args[0] === "label") return "";
    if (args[0] !== "api") throw Error("Unexpected fixture command");
    const endpoint = args[1], method = args[args.indexOf("--method") + 1] ?? "GET";
    const response = (data: unknown) => JSON.stringify(data);
    if (endpoint === "repos/owner/app") {
      if (method === "PATCH") Object.assign(f.metadata, JSON.parse(input!));
      return response(f.metadata);
    }
    if (endpoint === "repos/owner/app/branches/main") { if (!f.branchExists) throw new CommandError("gh", 1, 404); return response({ name: "main", commit: { sha: f.branchSha } }); }
    if (endpoint.startsWith("repos/owner/app/git/trees/")) {
      if (endpoint !== `repos/owner/app/git/trees/${f.contentSha}?recursive=1`) throw Error("Inventory must use the verified immutable default-branch head");
      if (f.treeError) throw new CommandError("gh", 1, f.treeError);
      return response(f.treeResponse ?? { sha: "d".repeat(40), truncated: false, tree: f.committedFiles.map(file => ({ path: file, type: "blob", mode: "100644", sha: "e".repeat(40) })) });
    }
    if (endpoint.endsWith("/protection")) { if (f.protectionError) throw new CommandError("gh", 1, f.protectionError); return response(f.protection); }
    if (endpoint.startsWith("repos/owner/app/rules/branches/main")) { if (f.rulesError) throw new CommandError("gh", 1, f.rulesError); return response(f.rules); }
    if (endpoint.startsWith("repos/owner/app/rulesets?")) return response(f.managedRuleset ? [{ ...f.managedRuleset, source_type: "Repository", source: "owner/app" }] : []);
    if (endpoint === "repos/owner/app/rulesets" || endpoint === "repos/owner/app/rulesets/99" && method === "PUT") {
      f.managedRuleset = { id: 99, ...JSON.parse(input!) };
      f.details = [{ id: 99, enforcement: "active", bypass_actors: [] }];
      f.rules = f.managedRuleset!.rules.map(rule => ({ ...rule, ruleset_id: 99, ruleset_source: "owner/app", ruleset_source_type: "Repository" })) as Rule[];
      return response(f.managedRuleset);
    }
    if (/rulesets\/\d+$/.test(endpoint)) {
      if (f.rulesetDetailError) throw new CommandError("gh", 1, 403);
      const id = Number(endpoint.split("/").pop());
      return response(id === 99 && f.managedRuleset ? f.managedRuleset : f.details.find(d => d.id === id));
    }
    if (endpoint === "user" || endpoint === "orgs/owner") return response({ login: "owner", plan: { name: f.plan } });
    if (endpoint.startsWith("repos/owner/app/pulls?")) return response(f.hasPr ? [{ number: 1 }] : []);
    if (/repos\/owner\/app\/pulls\/\d+$/.test(endpoint)) return response({ number: 1, base: { ref: "main", repo: { full_name: "owner/app" } }, head: { sha: "a".repeat(40) }, merge_commit_sha: null });
    if (endpoint.includes("check-runs?")) return response({ total_count: f.discovered.length, check_runs: f.discovered.map(c => ({ name: c.context, head_sha: "a".repeat(40), app: { id: c.appId, slug: "github-actions" }, pull_requests: [{ number: 1 }] })) });
    if (endpoint.includes("actions/variables?") || endpoint.includes("actions/organization-variables?")) {
      const organization = endpoint.includes("organization-variables");
      if (organization && f.organizationVariableError) throw new CommandError("gh", 1, f.organizationVariableError);
      if (!organization && f.variableError) throw Error("private credentials must stay withheld");
      if (Object.hasOwn(f.variableResponses, endpoint)) return response(f.variableResponses[endpoint]);
      const query = new URLSearchParams(endpoint.split("?")[1]), size = Number(query.get("per_page")), page = Number(query.get("page"));
      if (size !== 30 || page < 1) throw Error("Variables must respect the documented page limit");
      const variables = organization ? f.organizationVariables : f.variables;
      return response({ total_count: variables.length, variables: variables.slice((page - 1) * size, page * size) });
    }
    if (endpoint.startsWith("apps/")) return response({ id: 42, slug: "app-updater", permissions: f.appPermissions });
    if (endpoint.includes("/contents/")) {
      if (!endpoint.endsWith(`?ref=${f.contentSha}`)) throw Error("Content must use the verified immutable default-branch head");
      if (endpoint.includes("/contents/.github/repository-workflow.json")) {
        if (f.advanceBranchOnPolicyRead) f.branchSha = "c".repeat(40);
        if (f.policyError || f.committedPolicy === undefined) throw new CommandError("gh", 1, f.policyError ?? 404);
        return response({ encoding: "base64", content: Buffer.from(f.committedPolicy).toString("base64") });
      }
      if (endpoint.includes("/contents/.github/workflows/update-platform.yml")) return response({ encoding: "base64", content: Buffer.from(f.caller).toString("base64") });
    }
    if (endpoint.startsWith("installation/repositories")) { if (f.credentialError) throw new CommandError("gh", 1, 403); return response({ total_count: f.installationRepos.length, repositories: f.installationRepos.map(full_name => ({ full_name })) }); }
    if (endpoint === "graphql") return response({ data: { viewer: { login: f.viewer } } });
    throw Error("Unexpected fixture endpoint: " + endpoint);
  };
  return Object.assign(f, { exec });
}
