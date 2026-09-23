"""Pure reconciliation. Unknown is preferable to joining on a short SHA or time."""
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import re
from urllib.parse import quote, urlparse

from .sources import full_sha


def utc(value) -> str:
    try:
        if isinstance(value, (int, float)):
            date = datetime.fromtimestamp(value / 1000, timezone.utc)
        elif value:
            date = datetime.fromisoformat(value.replace("Z", "+00:00"))
            date = date.replace(tzinfo=timezone.utc) if date.tzinfo is None else date.astimezone(timezone.utc)
        else:
            return ""
        return date.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (ValueError, TypeError, OverflowError, OSError):
        return ""


def safe_url(value) -> str:
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return ""
        # No query strings: signed URLs and access tokens must never reach output.
        return f"https://{parsed.netloc}{parsed.path}".rstrip("/")
    except ValueError:
        return ""


@dataclass
class Event:
    id: str
    kind: str
    app: str | None
    sha: str | None
    environment: str | None
    time: str
    state: str
    source: str
    url: str = ""
    updated_at: str = ""
    context_sha: str | None = None
    name: str = ""
    input_hash: str | None = None
    expires_at: str = ""
    current: bool | None = None
    notes: list[str] = field(default_factory=list)
    related: list[str] = field(default_factory=list)


def newest(events):
    return sorted(events, key=lambda e: (e.time, e.id), reverse=True)


def reconcile(snapshot: dict, apps: list[str]) -> list[Event]:
    repo = snapshot["repo"]
    base = f"https://github.com/{repo}"
    tags = snapshot["tags"]
    runs = {r["id"]: r for r in snapshot["runs"]}
    jobs = {j["id"]: j for j in snapshot["jobs"]}
    run_targets = {}
    run_envs = {}
    for run_id, run in runs.items():
        path = run.get("path", "").split("/")[-1]
        run_tags = [t for t in tags if t["run_id"] == run_id and t["name"].startswith("deploy/")]
        targets = {t["sha"] for t in run_tags}
        envs = {t["name"].split("/")[1] for t in run_tags}
        if (path == "cd-staging.yml" or path.startswith("ci-")) and run.get("event") in ("push", "workflow_dispatch"):
            targets.add(full_sha(run.get("head_sha")))
        run_targets[run_id] = next(iter(targets)) if len(targets) == 1 else None
        run_envs[run_id] = ("staging" if path == "cd-staging.yml" else "production" if path == "cd-production.yml"
                           else next(iter(envs)) if len(envs) == 1 else None)

    def job_app(job):
        match = re.fullmatch(r"(?:Build|Resolve|Deploy) (.+?)(?: Artifact)? \((?:Staging|Production|Rollback)\)", job.get("name", ""))
        app = match[1].lower().replace(" ", "-") if match else None
        return app if app in apps or app == "convex" else None

    events = []
    for run in runs.values():
        run_id = run["id"]
        context = full_sha(run.get("head_sha"))
        target = run_targets[run_id]
        note = [] if target else ["Requested checkout SHA unknown; workflow head is NOT the deployment target"]
        events.append(Event(f"run:{run_id}", "workflow", None, target, run_envs[run_id], utc(run.get("created_at")),
                            run.get("conclusion") or run.get("status", "unknown"), run.get("path", "").split("/")[-1],
                            f"{base}/actions/runs/{run_id}", utc(run.get("updated_at")), context,
                            name=f"attempt {run.get('run_attempt', 1)}", notes=note))
    for job in jobs.values():
        run_id = job["run_id"]
        # Reusable CI calls appear as "ci-web / Build & Bundle Size"; standalone
        # CI runs identify the app in the workflow filename. A successful Build
        # step is evidence of a CI build, not a prebuilt deployable upload.
        ci_name = re.fullmatch(r"ci-(.+) / Build(?: & Bundle Size)?", job.get("name", ""))
        path = runs.get(run_id, {}).get("path", "").split("/")[-1]
        ci_app = ci_name[1] if ci_name else path[3:-4] if path.startswith("ci-") and job.get("name") in ("Build", "Build & Bundle Size") else None
        if ci_app in apps:
            step = next((s for s in job.get("steps", []) if s.get("name") == "Build"), {})
            events.append(Event(f"ci-build:{job['id']}", "ci-build", ci_app, run_targets.get(run_id), None,
                                utc(step.get("started_at") or job.get("started_at")),
                                step.get("conclusion") or job.get("conclusion") or job.get("status", "unknown"),
                                f"run {run_id}", safe_url(job.get("html_url")),
                                utc(step.get("completed_at") or job.get("completed_at")),
                                full_sha(runs.get(run_id, {}).get("head_sha")), name=job.get("name", ""),
                                notes=["CI build only; no deployable bundle implied. PR checkout SHA not inferred from head_sha."]))
        app = job_app(job)
        if not app:
            continue
        deploy = job.get("name", "").startswith("Deploy ")
        events.append(Event(f"job:{job['id']}", "deploy-job" if deploy else "build-resolve", app,
                            run_targets.get(run_id), run_envs.get(run_id), utc(job.get("started_at")),
                            job.get("conclusion") or job.get("status", "unknown"), f"run {run_id}",
                            safe_url(job.get("html_url")), utc(job.get("completed_at")),
                            full_sha(runs.get(run_id, {}).get("head_sha")), name=job.get("name", ""),
                            notes=["Job result, not a serving-state or new-build guarantee"]))
    for artifact in snapshot["artifacts"]:
        app = next((a for a in sorted(apps, key=len, reverse=True) if artifact.get("name", "").startswith(a + "-")), None)
        if not app:
            continue
        suffix = artifact["name"][len(app) + 1:]
        match = re.fullmatch(r"(?:(?:staging|production|preview)-)?([0-9a-f]{16}|[0-9a-f]{40})", suffix)
        if not match:
            continue  # Test reports / CI build directories are not prebuilt CD bundles.
        run_id = (artifact.get("workflow_run") or {}).get("id")
        expiry = utc(artifact.get("expires_at"))
        expired = artifact.get("expired") is True or (expiry and expiry <= utc(snapshot["gathered_at"]))
        state = "expired" if expired else "available" if artifact.get("expired") is False and expiry else "unknown"
        sha = run_targets.get(run_id)
        events.append(Event(f"artifact:{artifact['id']}", "artifact", app, sha, None,
                            utc(artifact.get("created_at")), state, f"build run {run_id or 'unknown'}",
                            f"{base}/actions/runs/{run_id}/artifacts/{artifact['id']}" if run_id else "",
                            context_sha=full_sha((artifact.get("workflow_run") or {}).get("head_sha")),
                            name=artifact["name"], input_hash=match[1] if len(match[1]) == 16 else None, expires_at=expiry,
                            notes=["Upload time; checkout SHA from workflow evidence, not verified provenance",
                                   "Manifest, tarball checksum and SLSA attestation not downloaded or verified"] +
                                  ([] if sha else ["Builder checkout unknown; artifact head_sha is context only"])))
    for tag in tags:
        deploy = tag["name"].startswith("deploy/")
        events.append(Event("tag:" + tag["name"], "deploy-tag" if deploy else "release-tag", None,
                            tag["sha"], tag["name"].split("/")[1] if deploy else None,
                            utc(tag["time"]), "recorded" if deploy else "source-release", "git tag",
                            f"{base}/tree/{quote(tag['name'], safe='')}", name=tag["name"],
                            notes=["Repository-wide marker; does not prove every app deployed or is healthy"] if deploy
                            else ["Starter source version; not a deployable artifact or deployment"]))
    for row in snapshot["vercel"]:
        dep = row["deployment"]
        meta = dep.get("meta") or {}
        claims = {full_sha(meta.get(key)) for key in ("githubCommitSha", "gitCommitSha")}
        claims.discard(None)
        sha = next(iter(claims)) if len(claims) == 1 else None
        notes = ["Vercel git metadata; no artifact identity supplied"]
        if len(claims) > 1:
            notes.append("Conflicting commit metadata; SHA withheld")
        if meta.get("githubCommitOrg") and meta.get("githubCommitRepo") and f"{meta['githubCommitOrg']}/{meta['githubCommitRepo']}".lower() != repo.lower():
            sha = None
            notes.append("Metadata names a different repository; SHA withheld")
        events.append(Event(f"vercel:{dep['uid']}", "vercel", row["app"], sha, row["environment"],
                            utc(dep.get("createdAt") or dep.get("created")),
                            dep.get("readyState") or dep.get("state", "unknown"), "Vercel " + row["project"],
                            safe_url(dep["url"] if dep["url"].startswith("https://") else "https://" + dep["url"]) if dep.get("url") else "",
                            utc(dep.get("ready") or dep.get("readyAt")), current=row["current"], notes=notes))
    for dep in snapshot["deployments"]:
        statuses = sorted(dep.get("statuses", []), key=lambda s: (s.get("created_at", ""), s.get("id", 0)), reverse=True)
        status = statuses[0] if statuses else {}
        url = next((safe_url(s.get("environment_url")) for s in statuses if safe_url(s.get("environment_url"))), "")
        log = next((safe_url(s.get("log_url")) for s in statuses if safe_url(s.get("log_url"))), "")
        match = re.fullmatch(re.escape(base) + r"/actions/runs/(\d+)/job/(\d+)", log)
        run_id = int(match[1]) if match else None
        job = jobs.get(int(match[2]), {}) if match else {}
        app, target = job_app(job), run_targets.get(run_id)
        peers = [e for e in events if e.kind == "vercel" and url and e.url == url and e.environment == dep.get("environment") and (not app or e.app == app)]
        notes = ["GitHub environment status; inactive is not proof of Vercel serving state"]
        if len(peers) == 1:
            app = app or peers[0].app
            if target and peers[0].sha and target != peers[0].sha:
                notes.append("CONFLICT: workflow target and Vercel commit differ; SHA withheld")
                peers[0].notes.append("CONFLICT: GitHub workflow target differs; inspect both sources")
                target = None
            else:
                target = target or peers[0].sha
        if not target:
            notes.append("Deployment target unknown; GitHub deployment.sha is context only")
        event = Event(f"github-deployment:{dep['id']}", "github-deployment", app, target,
                      dep.get("environment"), utc(dep.get("created_at")), status.get("state", "unknown"),
                      f"GitHub deployment {dep['id']}", url or log, utc(status.get("created_at")),
                      full_sha(dep.get("sha")), notes=notes, related=[e.id for e in peers])
        for peer in peers:
            peer.related.append(event.id)
        events.append(event)
    # A commit/app join is a browsing link, NOT a claim that these bytes shipped.
    for event in events:
        if event.sha and event.app and event.kind in ("vercel", "github-deployment", "deploy-job"):
            event.related += [a.id for a in events if a.kind == "artifact" and a.sha == event.sha and a.app == event.app]
    return newest(events)


def candidates(snapshot: dict, events: list[Event], apps: list[str], limit: int, sha: str | None = None):
    commits = {e.sha for e in events if e.sha and e.kind != "release-tag"}
    if sha:
        commits = {sha}
    ordered = sorted(commits, key=lambda s: (max((e.time for e in events if e.sha == s), default=""), s), reverse=True)
    rows = []
    for commit in ordered[:limit]:
        records = [e for e in events if e.sha == commit]
        staging = [e for e in records if e.kind == "deploy-tag" and e.environment == "staging"]
        production = [e for e in records if e.kind == "deploy-tag" and e.environment == "production"]
        gate = snapshot["gates"].get(commit, {"state": "unknown"})
        state = gate["state"]
        classification = "gates-pass" if staging and state == "success" else "blocked" if state in ("failure", "error", "pending") else "insufficient-evidence"
        reasons = (["Verified staging tag"] if staging else ["No verified staging tag in inspected evidence"])
        reasons.append(f"ci/gate-passed: {state}")
        artifacts = {}
        for app in apps:
            builds = [e for e in records if e.kind == "artifact" and e.app == app]
            artifacts[app] = [{"name": e.name, "state": e.state, "url": e.url, "uploaded_at": e.time,
                               "expires_at": e.expires_at, "input_hash": e.input_hash} for e in builds]
        rows.append({"sha": commit, "classification": classification, "reasons": reasons,
                     "staging": [e.time for e in staging], "production": [e.time for e in production],
                     "gate_url": safe_url(gate.get("target_url")), "artifacts": artifacts,
                     "release_tags": [e.name for e in records if e.kind == "release-tag"],
                     "limitations": ["Gates only, not approval or a deployment/health guarantee",
                                     "Same-checkout uploads only; input-hash equivalence and reusable artifacts remain unresolved",
                                     "Production resolves or builds on a miss; landing configuration is environment-specific",
                                     "No manifest/checksum/attestation verification; no Convex compatibility check"]})
    return rows


def event_json(event: Event):
    return asdict(event)
