import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { evaluator, localSignals, parseWorkflow, source, verifiedSource } from "./workflow-runners.ts";

const directory = new URL("../../../.github/workflows/", import.meta.url);
const workflows = readdirSync(directory).filter(file => /\.ya?ml$/.test(file)).map(file => ({ file, ...parseWorkflow(readFileSync(new URL(file, directory), "utf8")) }));
const diagnostic = (file: string, id: string) => file === "platform-update-workers-check.yml" || file === "ci-verify.yml" && ["worker-first", "worker-second"].includes(id);
const combinations = Array.from({ length: 64 }, (_, mask) => Object.fromEntries(Object.entries(localSignals).filter((_, index) => mask & (1 << index))));

test("public and unknown visibility always select hosted for every shipped job despite every override combination", () => {
  for (const privacy of [false, undefined, null]) for (const vars of combinations) {
    for (const event of ["push", "pull_request", "schedule", "workflow_dispatch"]) {
      const evaluate = evaluator(privacy, vars, event);
      for (const { file, jobs } of workflows) for (const [id, job] of Object.entries(jobs)) {
        if (!job["runs-on"]) continue;
        assert.deepEqual(evaluate.runners(job["runs-on"]), ["ubuntu-latest"], `${file}/${id}, visibility=${privacy}, event=${event}, vars=${JSON.stringify(vars)}`);
      }
    }
  }
});

test("private hosted defaults and every local-only combination preserve owner choice without hosted fallback", () => {
  for (const vars of combinations) for (const event of ["push", "schedule", "workflow_dispatch"]) {
    for (const workflow of ["CI Web", "Deploy staging"]) {
      const evaluate = evaluator(true, vars, event, workflow);
      for (const { file, jobs } of workflows) for (const [id, job] of Object.entries(jobs)) {
        if (!job["runs-on"] || diagnostic(file, id) || id === "reject-public-workers") continue;
        const labels = evaluate.runners(job["runs-on"]);
        if (!Object.keys(vars).length) assert.deepEqual(labels, ["ubuntu-latest"], `${file}/${id}`);
        else assert(!labels.includes("ubuntu-latest"), `${file}/${id} falls back hosted: ${JSON.stringify(vars)}`);
        if (labels.some(label => ["starter-pool", "starter-update", "starter-delivery"].includes(label))) {
          assert(labels.includes("starter-run-123"), `${file}/${id}: run binding`);
          assert(labels.some(label => label === `starter-source-${source}` || label === `starter-source-${verifiedSource}`), `${file}/${id}: source binding`);
        }
      }
    }
  }
});

test("private auxiliary labels cannot accidentally select a hosted provider or inject JSON", () => {
  for (const label of ["ubuntu-latest", "windows-latest", 'custom "quoted" label']) {
    const evaluate = evaluator(true, { PLATFORM_CI_AUX_RUNNER: label }, "schedule", "Deploy staging");
    for (const { file, jobs } of workflows) for (const [id, job] of Object.entries(jobs)) {
      if (!job["runs-on"] || diagnostic(file, id) || id === "reject-public-workers") continue;
      assert.deepEqual(evaluate.runners(job["runs-on"]), ["self-hosted", label], `${file}/${id}`);
    }
  }
});

test("public worker requests fail explicitly on hosted; private diagnostics retain exact source/run/role labels", () => {
  for (const file of ["ci-verify.yml", "platform-update-workers-check.yml"]) {
    const workflow = workflows.find(w => w.file === file)!;
    const rejection = workflow.jobs["reject-public-workers"];
    assert(rejection, file);
    for (const privacy of [false, true]) {
      const evaluate = evaluator(privacy);
      assert.equal(evaluate.value(rejection.if!), !privacy);
      if (!privacy) {
        const result = spawnSync("bash", ["-e", "-c", rejection.steps![0].run!], { encoding: "utf8" });
        assert.equal(result.status, 1);
        assert.match(result.stdout + result.stderr, /Public repositories.*GitHub-hosted/);
      }
      for (const [id, job] of Object.entries(workflow.jobs)) {
        if (id === "reject-public-workers" || !diagnostic(file, id)) continue;
        assert.equal(evaluate.value(job.if!), privacy, `${file}/${id} visibility admission`);
        if (privacy) {
          const pool = file === "ci-verify.yml" ? "starter-diagnostic" : id === "deliver" ? "starter-deliver" : "starter-verify";
          const expected = ["self-hosted", pool, `starter-source-${source}`, "starter-run-123"];
          if (file !== "ci-verify.yml") expected.push("starter-attempt-2", `starter-update-${id}`);
          assert.deepEqual(evaluate.runners(job["runs-on"]!), expected);
        } else {
          evaluate.context.inputs.verify = "malformed";
          evaluate.context.inputs.deliver = "malformed";
          assert.deepEqual(evaluate.runners(job["runs-on"]!), ["ubuntu-latest"]);
        }
      }
    }
  }
});
