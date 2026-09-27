import { expect, test } from "bun:test";
import { deploymentProgress } from "../src/deployment-progress";
import type { Report } from "../src/operations";
const report = (data: Report["data"]): Report => ({ data, errors: [], warnings: [], coverage: [], observedAt: "2026-09-24T02:40:00Z" });

test("live progress includes active jobs beyond the first six and distinguishes passed from skipped", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ({ job: `ci-web / Check ${i}`, status: "completed", conclusion: "success" })),
    { job: "ci-web / E2E Tests (shard 1/4)", status: "in_progress", conclusion: null, step: "Run Playwright" },
    { job: "Build Admin (Staging)", status: "completed", conclusion: "skipped" },
  ];
  const text = deploymentProgress(report({ status: "in_progress", rows }), undefined, 42, 1, 10).join("\n");
  expect(text).toContain("Checks: 8 passed, 1 running");
  expect(text).toContain("Now: ci-web / E2E Tests (shard 1/4) · Run Playwright");
  expect(text).toContain("Artifacts: 1 skipped");
  expect(text).toContain("Deployment: not started"); expect(text).not.toContain("COMPLETE");
});
test("workflow success is still verifying until the intended serving state is confirmed", () => {
  const workflow = report({ status: "completed", conclusion: "success", rows: [] });
  expect(deploymentProgress(workflow, undefined, 42, 1, 10).join("\n")).toContain("VERIFYING");
  const incomplete = report({ outcome: "incomplete", rows: [{ app: "web", state: "incomplete", reason: "Missing identity" }] });
  const text = deploymentProgress(workflow, incomplete, 42, 1, 10).join("\n");
  expect(text).toContain("VERIFYING"); expect(text).toContain("Missing identity"); expect(text).not.toContain("COMPLETE");
  expect(deploymentProgress(workflow, report({ outcome: "serving" }), 42, 1, 10).join("\n")).toContain("COMPLETE");
});
test("failure and observation errors never look like successful completion", () => {
  const failed = report({ status: "completed", conclusion: "failure", rows: [{ job: "Deploy Web", status: "completed", conclusion: "failure" }] });
  expect(deploymentProgress(failed, undefined, 42, 1, 10).join("\n")).toContain("Failed: Deploy Web");
  const error = { ...report(null), errors: [{ code: "AUTH", message: "Access denied", hint: "Log in", details: {} }] };
  const text = deploymentProgress(error, undefined, 42, 1, 10, undefined, true).join("\n");
  expect(text).toContain("NEEDS ATTENTION"); expect(text).toContain("Access denied"); expect(text).not.toContain("Retrying automatically");
});
