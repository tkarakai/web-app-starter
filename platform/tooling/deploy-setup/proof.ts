import { randomUUID } from "node:crypto";
import { proofContext, readPublicFile, type App, type State } from "./model.ts";
import type { Run } from "./io.ts";
export type ProofIO = {
  github: <T>(endpoint: string) => Promise<T>;
  run: Run;
  watch: (args: string[]) => Promise<void>;
  verify: () => Promise<void>;
  confirm: (message: string) => Promise<void>;
  save: (state: State) => void;
  tell: (message: string) => void;
};
export function checkProofMappings(state: State, installed: App[], root = process.cwd()) {
  const config = JSON.parse(readPublicFile(root, "ops.config.json") ?? "{}") as {
    repository?: string; teamId?: string; workflowRef?: string;
    apps?: Record<string, { projects?: { staging?: { id?: string; domain?: string } } }>;
  };
  if (config.repository !== state.repository || config.teamId !== state.team || config.workflowRef !== state.branch
    || Object.keys(config.apps ?? {}).sort().join() !== [...installed].sort().join()
    || installed.some(app => {
      const expected = state.projects[`${app}/staging`], actual = config.apps?.[app]?.projects?.staging;
      return !expected || actual?.id !== expected.id || actual?.domain !== expected.domain;
    })) throw Error("Staging mappings differ from ops.config.json; resume deploy:setup before proving deployment.");
}
export async function verifyServing(state: State, installed: App[], exec: Run, root = process.cwd()) {
  checkProofMappings(state, installed, root);
  if (!state.proof) throw Error("No saved staging proof");
  await exec("bun", ["run", "ops", "verify", "--run", state.proof, "--env", "staging", "--repo", state.repository, "--json"], undefined, undefined, root);
}
/** Save intent before dispatch; a resumed/ambiguous request is observed, never re-dispatched. */
export async function stagingProof(state: State, installed: App[], io: ProofIO) {
  const context = proofContext(state, installed);
  const current = state.request?.context === context;
  if (state.proof && current) {
    await io.verify();
    io.tell(`Staging verified: https://github.com/${state.repository}/actions/runs/${state.proof}`);
    return;
  }
  if (!state.request || !current) {
    const commit = await io.github<{ sha: string }>(`commits/${encodeURIComponent(state.branch)}`);
    if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw Error("GitHub did not return an immutable commit SHA");
    await io.confirm(`${state.request ? "Saved evidence does not match the current setup. Authorize a new staging proof? " : ""}Deploy ${state.repository}@${commit.sha} to staging and watch the result?`);
    state.request = { id: randomUUID(), sha: commit.sha, context }; delete state.proof; io.save(state);
    await io.run("bun", ["run", "ops", "deploy", commit.sha, "--to", "staging", "--yes", "--json", "--repo", state.repository, "--request", state.request.id]);
  }
  const request = state.request!.id;
  io.tell(`Staging request ${request}. Resume monitoring with bun run ops watch --request ${request} --until serving`);
  await io.watch(["run", "ops", "watch", "--repo", state.repository, "--request", request, "--until", "serving"]);
  const runs = await io.github<{ workflow_runs: { id: number; display_title: string; conclusion: string; html_url: string }[] }>("actions/workflows/cd-staging.yml/runs?event=workflow_dispatch&per_page=100");
  const matched = runs.workflow_runs.filter(r => r.display_title.includes(`[ops:${request}]`));
  if (matched.length !== 1 || matched[0].conclusion !== "success") throw Error("Staging proof is not successful; inspect the existing request before trying again.");
  state.proof = String(matched[0].id); io.save(state);
  io.tell(`Verified staging: ${matched[0].html_url}`);
}
