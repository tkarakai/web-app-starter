import { pathToFileURL } from "node:url";

const FAST_PATH_HOURS = 12;
type Alert = {
  number: number;
  created_at: string;
  dependency: { package: { ecosystem: string; name: string }; manifest_path: string };
  security_advisory: { ghsa_id: string; severity: string; summary: string };
  security_vulnerability: { first_patched_version: { identifier: string } | null };
};
type RegistryTimes = Record<string, Record<string, string>>;
export type RaceAssessment = {
  actionable: { alert: Alert; fixed: string; fixedPublishedAt: string; recognizedAfterRenovate: boolean }[];
  coolingDown: { alert: Alert; fixed: string; fixedPublishedAt: string }[];
  noFixedRelease: Alert[];
};

function date(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label} timestamp: ${value}`);
  return parsed;
}

/** Classify GitHub's open alerts independently of Bun's advisory feed. */
export function assessAdvisoryRace(alerts: Alert[], registryTimes: RegistryTimes, renovateCompletedAt: string | undefined, now: string, fastPathHours = FAST_PATH_HOURS): RaceAssessment {
  const result: RaceAssessment = { actionable: [], coolingDown: [], noFixedRelease: [] };
  const nowTime = date(now, "observation");
  const renovateTime = renovateCompletedAt ? date(renovateCompletedAt, "Renovate completion") : undefined;
  for (const alert of alerts) {
    if (alert.dependency.package.ecosystem !== "npm" || !["high", "critical"].includes(alert.security_advisory.severity.toLowerCase())) continue;
    const fixed = alert.security_vulnerability.first_patched_version?.identifier;
    if (!fixed) { result.noFixedRelease.push(alert); continue; }
    const fixedPublishedAt = registryTimes[alert.dependency.package.name]?.[fixed];
    if (!fixedPublishedAt) throw new Error(`npm did not report a publication time for ${alert.dependency.package.name}@${fixed}`);
    const item = { alert, fixed, fixedPublishedAt };
    if (nowTime - date(fixedPublishedAt, "fixed release") < fastPathHours * 60 * 60 * 1000) result.coolingDown.push(item);
    else result.actionable.push({ ...item, recognizedAfterRenovate: renovateTime === undefined || date(alert.created_at, "alert recognition") > renovateTime });
  }
  return result;
}

async function github<T>(path: string, token: string): Promise<{ value: T; observedAt: string; requestId: string; hasNextPage: boolean }> {
  const response = await fetch(`https://api.github.com${path}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } });
  if (!response.ok) throw new Error(`GitHub advisory evidence unavailable (${response.status})`);
  return { value: await response.json() as T, observedAt: response.headers.get("date") ?? new Date().toISOString(), requestId: response.headers.get("x-github-request-id") ?? "unavailable", hasNextPage: /rel="next"/.test(response.headers.get("link") ?? "") };
}

async function registryTimes(packageNames: string[]): Promise<RegistryTimes> {
  const result: RegistryTimes = {};
  await Promise.all([...new Set(packageNames)].map(async name => {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`npm publication evidence unavailable for ${name} (${response.status})`);
    const body = await response.json() as { time?: Record<string, string> };
    if (!body.time || typeof body.time !== "object") throw new Error(`npm publication evidence malformed for ${name}`);
    result[name] = body.time;
  }));
  return result;
}

export async function runRaceCheck(env = process.env): Promise<void> {
  const repository = env.GITHUB_REPOSITORY, token = env.GITHUB_TOKEN;
  if (!repository || !token) { console.log("Advisory race check skipped: GitHub Dependabot-alert freshness is only available in GitHub Actions."); return; }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid GITHUB_REPOSITORY");
  let alertsEvidence: { value: Alert[]; observedAt: string; requestId: string; hasNextPage: boolean };
  let runEvidence: { value: { workflow_runs: { updated_at: string; conclusion: string }[] }; observedAt: string; requestId: string; hasNextPage: boolean };
  try {
    alertsEvidence = await github<Alert[]>(`/repos/${repository}/dependabot/alerts?state=open&per_page=100`, token);
    runEvidence = await github<{ workflow_runs: { updated_at: string; conclusion: string }[] }>(`/repos/${repository}/actions/workflows/renovate.yml/runs?status=completed&per_page=1`, token);
  } catch (error) {
    console.warn(`::warning::Supplemental GitHub advisory evidence unavailable; the Bun audit remains authoritative for this run. ${String(error)}`);
    return;
  }
  if (!Array.isArray(alertsEvidence.value) || !Array.isArray(runEvidence.value.workflow_runs)) throw new Error("GitHub advisory evidence malformed");
  if (alertsEvidence.hasNextPage) throw new Error("More than 100 open Dependabot alerts; the supplemental advisory gate refuses incomplete evidence");
  const renovate = runEvidence.value.workflow_runs?.[0];
  const times = await registryTimes(alertsEvidence.value.flatMap(alert => alert.security_vulnerability.first_patched_version ? [alert.dependency.package.name] : []));
  const assessment = assessAdvisoryRace(alertsEvidence.value, times, renovate?.updated_at, alertsEvidence.observedAt);
  console.log(`Advisory evidence: GitHub Dependabot alerts observed ${alertsEvidence.observedAt} (request ${alertsEvidence.requestId}); latest Renovate completion ${renovate?.updated_at ?? "none"} (${renovate?.conclusion ?? "no run"}).`);
  for (const item of assessment.coolingDown) console.log(`Security fix cooling down: ${item.alert.security_advisory.ghsa_id}, ${item.alert.dependency.package.name}@${item.fixed}, published ${item.fixedPublishedAt}.`);
  for (const alert of assessment.noFixedRelease) console.warn(`::warning::${alert.security_advisory.ghsa_id} has no fixed npm release; the supplemental Renovate-race gate cannot repair it.`);
  if (assessment.actionable.length) {
    for (const item of assessment.actionable) console.error(`::error::${item.alert.security_advisory.ghsa_id} (${item.alert.security_advisory.severity}) remains open for ${item.alert.dependency.package.name} in ${item.alert.dependency.manifest_path}; fixed ${item.fixed} was published ${item.fixedPublishedAt}.${item.recognizedAfterRenovate ? " The alert was recognized after the latest Renovate run." : ""}`);
    throw new Error("Actionable high/critical Dependabot alert remains after the 12-hour security cooldown; dispatch Renovate, wait for it to finish, then rerun Security on the resulting commit");
  }
  console.log(`Advisory race check passed: no open high/critical npm alert has an age-eligible fixed release (${assessment.coolingDown.length} still inside the ${FAST_PATH_HOURS}-hour security cooldown).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRaceCheck().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
