"""Bounded GET-only collectors, with explicit coverage for every source.

Raw responses stay internal. Renderers receive only the evidence allowlist.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
import re
import subprocess
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, build_opener, HTTPRedirectHandler

from .config import Config, ROOT, WORKFLOWS


class SourceError(Exception):
    """Safe to display: never contains subprocess stderr or HTTP response bodies."""


def github_get(path: str):
    try:
        result = subprocess.run(["gh", "api", "--method", "GET", path],
                                capture_output=True, text=True, timeout=30,
                                env={**os.environ, "GH_HOST": "github.com", "GH_PROMPT_DISABLED": "1"})
        if result.returncode:
            raise SourceError("GitHub request failed; check gh auth, read permissions and rate limits")
        return json.loads(result.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        raise SourceError("GitHub unavailable; install/authenticate gh or check connection") from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def vercel_get(path: str):
    token = os.environ.get("VERCEL_TOKEN")
    if not token:
        raise SourceError("VERCEL_TOKEN not set")
    try:
        req = Request("https://api.vercel.com" + path, headers={"Authorization": f"Bearer {token}"}, method="GET")
        with build_opener(NoRedirect()).open(req, timeout=30) as response:
            payload = response.read(16 * 1024 * 1024 + 1)
            if len(payload) > 16 * 1024 * 1024:
                raise SourceError("Vercel response exceeded size limit")
            return json.loads(payload)
    except HTTPError as error:
        raise SourceError(f"Vercel HTTP {error.code}; check token, scope, project ID or rate limits") from None
    except (URLError, OSError, ValueError):
        raise SourceError("Vercel unavailable or invalid response") from None


def full_sha(value):
    return value.lower() if isinstance(value, str) and re.fullmatch(r"[a-fA-F0-9]{40}", value) else None


def tag_time(ref: str) -> str:
    match = re.search(r"/(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\dZ)/", ref)
    return f"{match[1]}:{match[2]}:{match[3]}" if match else ""


class Collector:
    def __init__(self, config: Config, limit: int, pages: int, gh=github_get, vercel=vercel_get):
        self.config, self.limit, self.pages = config, limit, pages
        self.gh, self.vercel = gh, vercel
        self.base = f"repos/{config.repo}"
        self.coverage = []

    def note(self, source: str, state: str, detail: str):
        self.coverage.append({"source": source, "state": state, "detail": detail})

    def get(self, path: str, label: str):
        try:
            return self.gh(f"{self.base}/{path}")
        except SourceError as error:
            self.note(label, "unavailable", str(error))
            return None

    def listing(self, path: str, label: str, key: str | None = None, page_size=100, pages=None):
        records = []
        seen = set()
        for page in range(1, (pages or self.pages) + 1):
            sep = "&" if "?" in path else "?"
            data = self.get(f"{path}{sep}per_page={page_size}&page={page}", label)
            if data is None:
                return records
            items = data.get(key) if key and isinstance(data, dict) else data
            if not isinstance(items, list):
                self.note(label, "unavailable", "Unexpected API response")
                return records
            fingerprint = json.dumps(items, sort_keys=True)
            if items and fingerprint in seen:
                self.note(label, "partial", "Pagination repeated a page; stopped")
                return records
            seen.add(fingerprint)
            records.extend(items)
            total = data.get("total_count") if isinstance(data, dict) else None
            if len(items) < page_size or (isinstance(total, int) and len(records) >= total):
                self.note(label, "complete", f"{len(records)} records")
                return records
        self.note(label, "windowed", f"{len(records)} records; page cap reached (increase --pages / --limit)")
        return records

    @staticmethod
    def parallel(function, items):
        with ThreadPoolExecutor(max_workers=6) as pool:
            return list(pool.map(function, items))

    def tags(self, prefix: str, sha: str | None):
        # Git matching-refs has no pagination parameters; unlike /tags it returns
        # refs (including the annotated-tag object ID), not peeled commits.
        refs = self.get(f"git/matching-refs/tags/{prefix}", f"{prefix} refs")
        if not isinstance(refs, list):
            return []
        self.note(f"{prefix} refs", "complete", f"{len(refs)} refs")
        if prefix == "deploy/":
            refs.sort(key=lambda r: (tag_time(r["ref"]), r["ref"]), reverse=True)
        else:
            refs = [r for r in refs if re.fullmatch(r"refs/tags/v\d+\.\d+\.\d+", r["ref"])]
            refs.sort(key=lambda r: tuple(map(int, r["ref"].split("/v")[-1].split("."))), reverse=True)
        if prefix == "deploy/":
            selected = [r for env in ("staging", "production")
                        for r in [r for r in refs if r["ref"].startswith(f"refs/tags/deploy/{env}/")][:self.limit]]
        else:
            selected = refs[:self.limit]
        if sha:
            selected += [r for r in refs if r["ref"].endswith("/" + sha) and r not in selected]
        if len(selected) < len(refs):
            self.note(f"{prefix} tag details", "windowed", f"Resolved {len(selected)} of {len(refs)} refs")

        def resolve(ref):
            obj, message = ref.get("object", {}), ""
            for _ in range(5):
                if obj.get("type") != "tag":
                    break
                detail = self.get(f"git/tags/{obj['sha']}", "tag detail")
                if not detail:
                    return None
                message += "\n" + detail.get("message", "")
                obj = detail.get("object", {})
            target = full_sha(obj.get("sha")) if obj.get("type") == "commit" else None
            if not target:
                self.note("tag detail", "partial", "Tag does not resolve to a full commit SHA")
                return None
            name = ref["ref"].removeprefix("refs/tags/")
            # A suffix alone is never sufficient to establish a deployed commit.
            if prefix == "deploy/" and name.rsplit("/", 1)[-1] != target:
                self.note("tag detail", "partial", "Deployment tag suffix and target differ; ignored")
                return None
            match = re.search(r"Workflow run: https://github\.com/" + re.escape(self.config.repo) + r"/actions/runs/(\d+)\b", message)
            return {"name": name, "sha": target, "time": tag_time(ref["ref"]),
                    "run_id": int(match[1]) if match else None}
        return [t for t in self.parallel(resolve, selected) if t]

    def collect(self, sha: str | None = None, no_vercel=False):
        tags = self.tags("deploy/", sha) + self.tags("v", None)
        workflows = list(WORKFLOWS) + [f"ci-{app}.yml" for app in self.config.apps
                                       if (ROOT / ".github/workflows" / f"ci-{app}.yml").is_file()]
        def workflow_runs(workflow):
            query = f"&head_sha={sha}" if sha and workflow not in ("cd-production.yml", "cd-rollback.yml") else ""
            return self.listing(f"actions/workflows/{workflow}/runs?exclude_pull_requests=true{query}",
                                workflow, "workflow_runs", self.limit, 1)
        runs = [r for batch in self.parallel(workflow_runs, workflows) for r in batch]
        # Fetch tagged runs even if older than the run window. Their annotations
        # establish the requested SHA of production / rollback dispatches.
        ids = {r["id"] for r in runs}
        for tag in tags:
            run_id = tag["run_id"]
            if run_id and run_id not in ids:
                run = self.get(f"actions/runs/{run_id}", "tag workflow")
                if run:
                    runs.append(run)
                    ids.add(run_id)

        def jobs(run):
            items = self.listing(f"actions/runs/{run['id']}/jobs?filter=latest", f"jobs/{run['id']}", "jobs")
            return [{**job, "run_id": run["id"]} for job in items]
        job_rows = [j for batch in self.parallel(jobs, runs) for j in batch]
        artifacts = self.listing("actions/artifacts", "artifacts", "artifacts")
        # A busy monorepo's test reports can crowd build uploads out of the
        # repository inventory. Inspect every selected CD run as well.
        def run_artifacts(run):
            return self.listing(f"actions/runs/{run['id']}/artifacts", f"artifacts/{run['id']}", "artifacts")
        cd_runs = [r for r in runs if r.get("path", "").split("/")[-1] in WORKFLOWS]
        artifacts += [a for batch in self.parallel(run_artifacts, cd_runs) for a in batch]
        artifacts = list({a["id"]: a for a in artifacts}.values())
        # Recover builder context outside the run window, but only for bundle
        # names this project recognizes (not thousands of test reports).
        app_pattern = "|".join(re.escape(app) for app in self.config.apps)
        builder_ids = {(a.get("workflow_run") or {}).get("id") for a in artifacts
                       if re.fullmatch(rf"(?:{app_pattern})-(?:(?:staging|production|preview)-)?(?:[0-9a-f]{{16}}|[0-9a-f]{{40}})", a.get("name", ""))}
        for run_id in sorted(builder_ids - ids - {None}):
            run = self.get(f"actions/runs/{run_id}", "artifact builder")
            if run:
                runs.append(run)
        deployments = []
        for env in ("staging", "production"):
            deployments += self.listing(f"deployments?environment={env}", f"deployments/{env}", page_size=min(100, self.limit * 4), pages=1)

        def with_status(dep):
            statuses = self.listing(f"deployments/{dep['id']}/statuses", f"deployment status/{dep['id']}")
            return {**dep, "statuses": statuses}
        deployments = self.parallel(with_status, deployments)
        vercel = self.collect_vercel(no_vercel)
        shas = {t["sha"] for t in tags}
        shas.update(full_sha(r.get("head_sha")) for r in runs if r.get("path", "").split("/")[-1] == "cd-staging.yml")
        if sha:
            shas.add(sha)
        shas.discard(None)

        def gate(commit):
            # Combined status returns latest status for each context, not a
            # stale successful status from an earlier workflow attempt.
            data = self.get(f"commits/{commit}/status?per_page=100", f"CI gate/{commit}")
            if data is None:
                return commit, {"state": "unknown"}
            gate = next((s for s in data.get("statuses", []) if s.get("context") == "ci/gate-passed"), None)
            if gate:
                return commit, {k: gate.get(k) for k in ("state", "target_url", "updated_at")}
            return commit, {"state": "missing" if data.get("total_count", 0) <= 100 else "unknown"}
        gates = dict(self.parallel(gate, sorted(shas)))
        return {"repo": self.config.repo, "gathered_at": datetime.now(timezone.utc).isoformat(),
                "tags": tags, "runs": runs, "jobs": job_rows, "artifacts": artifacts,
                "deployments": deployments, "vercel": vercel, "gates": gates,
                "coverage": sorted(self.coverage, key=lambda c: (c["source"], c["state"], c["detail"]))}

    def collect_vercel(self, disabled: bool):
        rows = []
        for app in self.config.apps:
            for env in ("staging", "production"):
                label = f"Vercel/{app}/{env}"
                project = self.config.projects.get(app, {}).get(env)
                if disabled or not project:
                    self.note(label, "unavailable", "Disabled by --no-vercel" if disabled else "Project ID not configured")
                    continue
                params = {"teamId": self.config.team_id} if self.config.team_id else {}
                current = None
                try:
                    detail = self.vercel(f"/v9/projects/{quote(project)}?{urlencode(params)}")
                    target = (detail.get("targets") or {}).get("production") or {}
                    current = target.get("id")
                    if not current:
                        self.note(label + "/current", "partial", "No production target reported; serving deployment unknown")
                except SourceError as error:
                    self.note(label + "/current", "unavailable", str(error))
                except (AttributeError, TypeError):
                    self.note(label + "/current", "partial", "Unexpected Vercel project response")
                try:
                    params.update({"projectId": project, "limit": 100})
                    seen = set()
                    for _ in range(self.pages):
                        data = self.vercel("/v7/deployments?" + urlencode(params))
                        for dep in data["deployments"]:
                            rows.append({"app": app, "environment": env, "project": project,
                                         "deployment": dep, "current": dep.get("uid") == current if current else None})
                        cursor = (data.get("pagination") or {}).get("next")
                        if not cursor:
                            self.note(label, "complete", "Deployment list exhausted")
                            break
                        if cursor in seen:
                            self.note(label, "partial", "Repeated pagination cursor; stopped")
                            break
                        seen.add(cursor)
                        params["until"] = cursor
                    else:
                        self.note(label, "windowed", "Page cap reached; increase --pages")
                except SourceError as error:
                    self.note(label, "unavailable", str(error))
                except (KeyError, TypeError, AttributeError):
                    self.note(label, "partial", "Unexpected Vercel response")
                # Preserve project evidence even when listing failed or the
                # serving deployment is older than the history window.
                if current and not any(r["deployment"].get("uid") == current for r in rows):
                    rows.append({"app": app, "environment": env, "project": project,
                                 "deployment": {**target, "uid": current}, "current": True})
        return rows
