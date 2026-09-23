"""Local configuration only. Never read repository secrets or Vercel env values."""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ENVIRONMENTS = ("staging", "production")
WORKFLOWS = ("cd-staging.yml", "cd-production.yml", "cd-rollback.yml")


@dataclass
class Config:
    repo: str
    apps: list[str]
    projects: dict[str, dict[str, str]]
    team_id: str | None = None


def load_config(path: str | None, repo: str | None) -> Config:
    data = {}
    if path:
        try:
            data = json.loads(Path(path).read_text())
        except (OSError, ValueError):
            raise ValueError("Cannot read configuration JSON") from None
    if not isinstance(data, dict) or set(data) - {"repo", "projects", "team_id"}:
        raise ValueError("Config supports only repo, projects and team_id (no credentials)")
    repo = repo or os.environ.get("GH_REPO") or data.get("repo")
    if not repo:
        result = subprocess.run(["git", "remote", "get-url", "origin"], cwd=ROOT,
                                capture_output=True, text=True, check=False)
        match = re.fullmatch(r"(?:https://github\.com/|git@github\.com:)([^\s]+?)(?:\.git)?", result.stdout.strip())
        repo = match[1] if match else None
    if not isinstance(repo, str) or not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        raise ValueError("Set --repo OWNER/REPO, GH_REPO or config.repo (github.com)")
    apps = sorted(p.parent.name for p in (ROOT / "apps").glob("*/package.json"))
    projects = data.get("projects", {})
    if not isinstance(projects, dict):
        raise ValueError("projects must map app names to staging/production project IDs")
    apps = sorted(set(apps) | set(projects))
    seen = set()
    for app in apps:
        if not re.fullmatch(r"[a-z][a-z0-9-]*", app):
            raise ValueError("Invalid application name in configuration")
        mapping = projects.setdefault(app, {})
        if not isinstance(mapping, dict) or set(mapping) - set(ENVIRONMENTS):
            raise ValueError("Each app supports staging and production project IDs only")
        for env in ENVIRONMENTS:
            key = f"VERCEL_PROJECT_ID_{app.upper().replace('-', '_')}" + ("_STAGING" if env == "staging" else "")
            project = os.environ.get(key) or mapping.get(env)
            if project is not None:
                if not isinstance(project, str) or not re.fullmatch(r"prj_[A-Za-z0-9]+", project):
                    raise ValueError("Use Vercel project IDs (prj_...), not names or URLs")
                if project in seen:
                    raise ValueError("A Vercel project may map to only one application/environment")
                seen.add(project)
                mapping[env] = project
    team = os.environ.get("VERCEL_ORG_ID") or data.get("team_id")
    if team is not None and (not isinstance(team, str) or not re.fullmatch(r"[A-Za-z0-9_]+", team)):
        raise ValueError("Invalid Vercel team_id")
    return Config(repo, apps, projects, team)
