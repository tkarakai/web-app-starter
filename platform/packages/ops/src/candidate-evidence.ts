import { artifactApp, deployedApps } from "./evidence";
import type { Artifact, Deployment } from "./types";

export interface AppBuildEvidence {
  app: string; result: string;
  artifactState: "new" | "reused" | "available" | "uploaded" | "expired" | "not-found" | "unknown" | "none" | "unchanged" | "source";
  artifact?: string; artifactId?: number; builtFrom?: string; inputHash?: string;
  artifactSource?: "staging-push-run"; artifactRun?: number; url?: string;
}
export interface PushArtifact { artifact: Artifact; sha: string; run: number; url: string }

/** Historical staging outcomes, never a claim about current target configuration. */
export function candidateEvidence(sha: string, records: Deployment[], artifacts: Artifact[], artifactsReadable = true, pushArtifacts: PushArtifact[] = [], uploadsComplete = false) {
  const relevant = records.filter(r => r.sha === sha && r.environment === "staging")
    .sort((a, b) => a.payload.runId === b.payload.runId
      ? Number(b.payload.runAttempt ?? 0) - Number(a.payload.runAttempt ?? 0) || b.created_at.localeCompare(a.created_at)
      : b.created_at.localeCompare(a.created_at) || b.id - a.id);
  const latest = relevant[0]?.payload;
  const identity = latest && Number.isSafeInteger(latest.runId) && Number(latest.runId) > 0
    && Number.isSafeInteger(latest.runAttempt) && Number(latest.runAttempt) > 0;
  const attempt = identity ? relevant.filter(r => r.payload.runId === latest.runId && r.payload.runAttempt === latest.runAttempt) : [];
  const appEvidence: AppBuildEvidence[] = [...deployedApps, "backend"].map(app => {
    const matches = attempt.filter(r => r.payload.app === app);
    // Never fill a missing outcome from an older attempt, or accept conflicting records.
    const record = matches.length === 1 && matches[0].payload.selectedSha === sha && matches[0].payload.schemaVersion === 1
      && matches[0].payload.environment === "staging" ? matches[0].payload : undefined;
    const result = record?.result ?? "unknown";
    if (result === "unchanged") return { app, result, artifactState: "unchanged" };
    if (app === "backend") return { app, result, artifactState: "source" };
    const details = { app, result, artifact: record?.artifactName, artifactId: record?.artifactId, builtFrom: record?.builtSha, inputHash: record?.inputHash };
    if (!record?.inputHash || record.artifactName !== `${app}-${record.inputHash}` || artifactApp(record.artifactName, [...deployedApps]) !== app || !record.artifactId || !artifactsReadable) {
      const uploaded = pushArtifacts.filter(({ artifact, sha: source }) => source === sha && artifactApp(artifact.name, [...deployedApps]) === app
        && !artifact.expired && Date.parse(artifact.expires_at) > Date.now()).sort((a, b) => b.artifact.created_at.localeCompare(a.artifact.created_at))[0];
      // Artifact uploads independently associate a package with a commit;
      // this does not establish a match with current target configuration.
      if (uploaded && (artifactsReadable || uploadsComplete)) return { app, result, artifactState: "uploaded", artifact: uploaded.artifact.name,
        artifactId: uploaded.artifact.id, artifactSource: "staging-push-run", artifactRun: uploaded.run, url: uploaded.url };
      if (uploadsComplete) {
        const expired = pushArtifacts.find(p => p.sha === sha && artifactApp(p.artifact.name, [...deployedApps]) === app);
        if (expired) return { app, result, artifactState: "expired", artifact: expired.artifact.name, artifactId: expired.artifact.id, artifactRun: expired.run, url: expired.url };
        return { ...details, artifactState: "none" };
      }
      return { ...details, artifactState: "unknown" };
    }
    const exact = artifacts.find(a => a.id === record.artifactId && a.name === record.artifactName);
    const available = (a: Artifact) => !a.expired && Date.parse(a.expires_at) > Date.now();
    if (exact && available(exact)) return { ...details, artifactState: record.buildResult === "success" && record.reused === false && record.builtSha === sha ? "new" : record.reused === true ? "reused" : "available" };
    if (artifacts.some(a => a.name === record.artifactName && available(a))) return { ...details, artifactState: "available" };
    return { ...details, artifactState: exact && (exact.expired || Date.parse(exact.expires_at) <= Date.now()) ? "expired" : "not-found" };
  });
  const apps = (state: AppBuildEvidence["artifactState"]) => appEvidence.filter(a => a.artifactState === state).map(a => a.app);
  const groups = ([ ["new", "new"], ["reused", "reused"], ["available", "existing"], ["uploaded", "artifacts"], ["expired", "expired"] ] as const)
    .flatMap(([state, label]) => apps(state).length ? [`${label}: ${apps(state).join("/")}`] : []);
  const backend = appEvidence.find(a => a.app === "backend")!;
  if (backend.result === "success") groups.push("backend deployed");
  const noAppChanges = appEvidence.every(a => a.result === "unchanged");
  const hasAvailableArtifacts = appEvidence.some(a => ["new", "reused", "available", "uploaded"].includes(a.artifactState));
  const hasProducedArtifacts = appEvidence.some(a => a.artifactState === "new" || a.artifactState === "uploaded");
  return { appEvidence, noAppChanges, hasAvailableArtifacts, hasProducedArtifacts, evidenceRun: identity ? latest.runId : null, evidenceAttempt: identity ? latest.runAttempt : null,
    artifactSummary: noAppChanges ? "all apps unchanged" : groups.join("; ") || (uploadsComplete ? "no current-format app artifacts" : "artifact availability unknown") };
}
