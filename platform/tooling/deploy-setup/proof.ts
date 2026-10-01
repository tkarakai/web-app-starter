import { randomUUID } from "node:crypto";
import type { State } from "./model.ts";
import type { Run } from "./io.ts";
export type ProofIO = {
  github: <T>(endpoint: string) => Promise<T>;
  run: Run;
  watch: (args: string[]) => Promise<void>;
  confirm: (message: string) => Promise<void>;
  save: (state: State) => void;
  tell: (message: string) => void;
};
/** Save intent before dispatch; a resumed/ambiguous request is observed, never re-dispatched. */
export async function stagingProof(state: State, io: ProofIO) {
  if (state.proof) {
    const prior = await io.github<{ conclusion: string; html_url: string }>(`actions/runs/${state.proof}`);
    if (prior.conclusion === "success") { io.tell(`Staging already verified: ${prior.html_url}`); return; }
  }
  if (!state.request) {
    const commit = await io.github<{ sha: string }>(`commits/${encodeURIComponent(state.branch)}`);
    if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw Error("GitHub did not return an immutable commit SHA");
    await io.confirm(`Deploy ${state.repository}@${commit.sha} to staging and watch the result?`);
    state.request = { id: randomUUID(), sha: commit.sha }; io.save(state);
    await io.run("bun", ["run", "ops", "deploy", commit.sha, "--to", "staging", "--yes", "--json", "--repo", state.repository, "--request", state.request.id]);
  }
  const request = state.request.id;
  io.tell(`Staging request ${request}. Resume monitoring with bun run ops watch --request ${request} --until serving`);
  await io.watch(["run", "ops", "watch", "--repo", state.repository, "--request", request, "--until", "serving"]);
  const runs = await io.github<{ workflow_runs: { id: number; display_title: string; conclusion: string; html_url: string }[] }>("actions/workflows/cd-staging.yml/runs?event=workflow_dispatch&per_page=100");
  const matched = runs.workflow_runs.filter(r => r.display_title.includes(`[ops:${request}]`));
  if (matched.length !== 1 || matched[0].conclusion !== "success") throw Error("Staging proof is not successful; inspect the existing request before trying again.");
  state.proof = String(matched[0].id); io.save(state);
  io.tell(`Verified staging: ${matched[0].html_url}`);
}
