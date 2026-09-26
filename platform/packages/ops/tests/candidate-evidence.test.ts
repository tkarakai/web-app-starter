import { expect, test } from "bun:test";
import { candidateEvidence } from "../src/candidate-evidence";
import type { Artifact, Deployment } from "../src/types";

const sha = "a".repeat(40), old = "b".repeat(40), hash = "a".repeat(16);
const apps = ["web", "admin", "landing", "backend"];
const unchanged = (): Deployment[] => apps.map((app, i) => ({ id: i + 1, sha, environment: "staging", created_at: "2026-09-23T12:00:00Z", task: "ops-record",
  payload: { schemaVersion: 1, environment: "staging", selectedSha: sha, app, runId: 42, runAttempt: 1, result: "unchanged" } }));
const artifact = (app: string, id: number): Artifact => ({ id, name: `${app}-${hash}`, expired: false, expires_at: "2099-01-01T00:00:00Z", created_at: "2026-09-23T12:00:00Z", size_in_bytes: 100 });

test("only explicit unchanged outcomes for all four components establish a no-change commit", () => {
  expect(candidateEvidence(sha, unchanged(), []).noAppChanges).toBe(true);
  for (const result of ["success", "failure", "skipped", "unknown", "cancelled"]) {
    const records = unchanged(); records[3].payload.result = result;
    expect(candidateEvidence(sha, records, []).noAppChanges).toBe(false);
  }
});
test("missing, conflicting and mismatched evidence never hides a commit", () => {
  expect(candidateEvidence(sha, [], []).noAppChanges).toBe(false);
  expect(candidateEvidence(sha, unchanged().slice(0, 3), []).noAppChanges).toBe(false);
  const duplicate = unchanged(); duplicate.push({ ...duplicate[0], id: 100 });
  expect(candidateEvidence(sha, duplicate, []).noAppChanges).toBe(false);
  const mismatch = unchanged(); mismatch[0].payload.selectedSha = old;
  expect(candidateEvidence(sha, mismatch, []).noAppChanges).toBe(false);
  const missingEnvironment = unchanged(); delete missingEnvironment[0].payload.environment;
  expect(candidateEvidence(sha, missingEnvironment, []).noAppChanges).toBe(false);
});
test("newer incomplete attempts cannot inherit an older no-change verdict", () => {
  const records = unchanged();
  records.push({ ...records[0], id: 5, created_at: "2026-09-24T12:00:00Z", payload: { ...records[0].payload, runAttempt: 2 } });
  const evidence = candidateEvidence(sha, records, []);
  expect(evidence.noAppChanges).toBe(false); expect(evidence.evidenceAttempt).toBe(2);
  expect(evidence.appEvidence.find(r => r.app === "admin")?.result).toBe("unknown");
});
test("historical uploads do not override explicit unchanged outcomes or a recorded target hash", () => {
  const uploaded = artifact("web", 11);
  const sources = [{ artifact: uploaded, sha, run: 40, url: "https://github.com/team/repo/actions/runs/40/artifacts/11" }];
  expect(candidateEvidence(sha, unchanged(), [uploaded], true, sources)).toMatchObject({ noAppChanges: true, artifactSummary: "all apps unchanged" });
  const records = unchanged();
  records[0].payload = { ...records[0].payload, result: "success", artifactName: `web-${"c".repeat(16)}`, artifactId: 12, inputHash: "c".repeat(16) };
  expect(candidateEvidence(sha, records, [uploaded], true, sources).appEvidence[0].artifactState).toBe("not-found");
  const fallback = candidateEvidence(sha, [], [uploaded], true, sources).appEvidence[0];
  expect(fallback.artifactState).toBe("uploaded");
  expect(fallback.builtFrom).toBeUndefined(); expect(fallback.inputHash).toBeUndefined();
  expect(candidateEvidence(sha, [], [uploaded], false, sources).artifactSummary).toBe("artifact availability unknown");
});
test("new artifacts, reused artifacts and backend-only deployment are separate outcomes", () => {
  const records = unchanged();
  records[0].payload = { ...records[0].payload, result: "success", buildResult: "success", artifactId: 11, artifactName: `web-${hash}`, inputHash: hash, builtSha: sha, reused: false };
  records[1].payload = { ...records[1].payload, result: "success", buildResult: "success", artifactId: 12, artifactName: `admin-${hash}`, inputHash: hash, builtSha: old, reused: true };
  const evidence = candidateEvidence(sha, records, [artifact("web", 11), artifact("admin", 12)]);
  expect(evidence.appEvidence.map(r => [r.app, r.artifactState])).toEqual([["web", "new"], ["admin", "reused"], ["landing", "unchanged"], ["backend", "unchanged"]]);
  expect(evidence.artifactSummary).toBe("new: web; reused: admin"); expect(evidence.noAppChanges).toBe(false);
  const backend = unchanged(); backend[3].payload.result = "success";
  expect(candidateEvidence(sha, backend, [])).toMatchObject({ noAppChanges: false, artifactSummary: "backend deployed" });
});
test("expired, replaced, unreadable and absent artifacts are not advertised as newly produced available artifacts", () => {
  const records = unchanged();
  records[0].payload = { ...records[0].payload, result: "success", buildResult: "success", artifactId: 11, artifactName: `web-${hash}`, inputHash: hash, builtSha: sha, reused: false };
  const state = (artifacts: Artifact[], readable = true) => candidateEvidence(sha, records, artifacts, readable).appEvidence[0].artifactState;
  expect(state([{ ...artifact("web", 11), expired: true }])).toBe("expired");
  expect(state([{ ...artifact("web", 11), expires_at: "2000-01-01T00:00:00Z" }])).toBe("expired");
  expect(state([artifact("web", 99)])).toBe("available");
  expect(state([artifact("web", 11)], false)).toBe("unknown");
  expect(state([])).toBe("not-found");
  expect(candidateEvidence(sha, records, []).noAppChanges).toBe(false);
});
test("only a confirmed producer qualifies by default; reuse, expiry and unknown do not", () => {
  const records = unchanged();
  records[0].payload = { ...records[0].payload, result: "success", buildResult: "success", artifactId: 11, artifactName: `web-${hash}`, inputHash: hash, builtSha: old, reused: true };
  expect(candidateEvidence(sha, records, [artifact("web", 11)])).toMatchObject({ hasAvailableArtifacts: true, hasProducedArtifacts: false, artifactSummary: "reused: web" });
  records[0].payload.builtSha = sha; records[0].payload.reused = false;
  expect(candidateEvidence(sha, records, [artifact("web", 11)])).toMatchObject({ hasAvailableArtifacts: true, hasProducedArtifacts: true, artifactSummary: "new: web" });
  expect(candidateEvidence(sha, records, [{ ...artifact("web", 11), expired: true }]).hasProducedArtifacts).toBe(false);
  expect(candidateEvidence(sha, records, [artifact("web", 99)]).hasProducedArtifacts).toBe(false);
  expect(candidateEvidence(sha, [], []).hasProducedArtifacts).toBe(false);
  expect(candidateEvidence(sha, unchanged(), []).hasProducedArtifacts).toBe(false);
});
test("a complete run artifact inventory distinguishes each app's absence from an incomplete lookup", () => {
  const web = artifact("web", 11);
  const sources = [{ artifact: web, sha, run: 42, url: "https://github.com/team/repo/actions/runs/42/artifacts/11" }];
  const complete = candidateEvidence(sha, [], [], true, sources, true);
  expect(complete.appEvidence.map(a => [a.app, a.artifactState])).toEqual([["web", "uploaded"], ["admin", "none"], ["landing", "none"], ["backend", "source"]]);
  expect(complete.artifactSummary).toBe("artifacts: web");
  expect(candidateEvidence(sha, [], [], true, [], true).artifactSummary).toBe("no current-format app artifacts");
  expect(candidateEvidence(sha, [], [], true, [], false).artifactSummary).toBe("artifact availability unknown");
});
test("legacy SHA-named archives cannot qualify through uploads or build records", () => {
  for (const name of [`web-${sha}`, `web-production-${sha}`, `web-staging-${hash}`]) {
    const legacy = { ...artifact("web", 11), name };
    const records = unchanged();
    records[0].payload = { ...records[0].payload, result: "success", buildResult: "success", artifactName: name, artifactId: 11,
      inputHash: name.slice(4), builtSha: sha, reused: false };
    const evidence = candidateEvidence(sha, records, [legacy], true, [{ artifact: legacy, sha, run: 42, url: "https://github.com/team/repo/actions/runs/42" }], true);
    expect(evidence.hasProducedArtifacts).toBe(false);
    expect(evidence.hasAvailableArtifacts).toBe(false);
    expect(evidence.appEvidence[0].artifactState).toBe("none");
  }
});
