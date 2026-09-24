#!/usr/bin/env python3
"""Rehearse on a copy of the REAL apps/demo, never a miniature substitute.

No install, git server, deployment, browser download or publishing credentials.
Only third-party node_modules are reused; foundation/workspace source is not.
Outputs are retained under .ci-local-artifacts/foundation-canary for CI evidence.
"""
from pathlib import Path
import json
import shutil
import subprocess
import sys

import upgrade as u

ROOT = Path(__file__).resolve().parents[2]


def copy_app(destination: Path) -> None:
    shutil.copytree(ROOT / "apps/demo", destination,
                    ignore=shutil.ignore_patterns("node_modules", ".next", ".turbo", ".foundation",
                                                  "next-env.d.ts", "*.tsbuildinfo", "out"))


def seed_baseline(app: Path, releases: Path) -> None:
    """Rehearsal-only historical install. Not an upgrade/downgrade escape hatch."""
    catalog = u.catalogue(releases)
    release = catalog["releases"]["1.0.0"]
    for path in release["files"]:
        (app / path).write_bytes((releases / "1.0.0" / path).read_bytes())
    u.atomic_json(app / u.LOCK, {"schemaVersion": 1, "rail": u.RAIL, "release": "1.0.0",
                               "releaseDigest": u.fingerprint(release), "files": release["files"],
                               "status": "baseline"})


def link_dependencies(source: Path, destination: Path) -> None:
    """Bun isolated linker: preserve only dependency links, with absolute targets."""
    destination.mkdir(parents=True, exist_ok=True)
    for path in source.iterdir():
        target = destination / path.name
        if path.is_symlink():
            resolved = path.resolve()
            u.require(resolved.is_relative_to(ROOT / "node_modules"),
                      f"Canary must not consume workspace source through a dependency: {path}")
            target.symlink_to(resolved, target_is_directory=path.is_dir())
        elif path.is_dir():
            link_dependencies(path, target)
        else:
            shutil.copy2(path, target)


def run(app: Path, command: list[str], log: Path, success: bool = True) -> None:
    with log.open("wb") as output:
        result = subprocess.run(command, cwd=app, stdout=output, stderr=subprocess.STDOUT,
                                check=False, timeout=600)
    u.require((result.returncode == 0) == success, f"Unexpected exit {result.returncode}: {command}; {log}")


def cli(app: Path, releases: Path, command: str, *args: str) -> dict:
    result = subprocess.run([sys.executable, str(ROOT / "scripts/foundation/upgrade.py"), command,
                             "--app", str(app), "--releases", str(releases), *args],
                            capture_output=True, text=True, check=False, timeout=900)
    u.require(result.returncode == 0, result.stderr)
    return json.loads(result.stdout)


def main() -> None:
    sandbox = ROOT / ".ci-local-artifacts/foundation-canary"
    # Fixed, worktree-local generated directory only. No git worktree or lifecycle operations.
    if sandbox.exists():
        shutil.rmtree(sandbox)
    app = sandbox / "apps/demo"
    releases = sandbox / "releases"
    copy_app(app)
    shutil.copytree(ROOT / "foundation/releases", releases)
    shutil.copy2(ROOT / "tsconfig.base.json", sandbox / "tsconfig.base.json")
    (sandbox / "package.json").write_text('{"private":true}\n')
    link_dependencies(ROOT / "apps/demo/node_modules", app / "node_modules")
    # Root TypeScript types are used by the inherited base config.
    (sandbox / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
    seed_baseline(app, releases)
    before = u.source_files(app)
    run(app, ["bun", "run", "test:business"], sandbox / "baseline-business.log")
    run(app, ["bun", "run", "typecheck"], sandbox / "baseline-types.log")
    # Prove the regression is real; a green merge/typecheck did not catch NaNrem.
    regression_report = sandbox / "baseline-regression.json"
    run(app, ["bun", "run", "test:foundation", "--reporter=json", f"--outputFile={regression_report}"],
        sandbox / "baseline-regression.log", success=False)
    regression = json.loads(regression_report.read_text())
    failed = [assertion for file in regression["testResults"] for assertion in file["assertionResults"]
              if assertion["status"] == "failed"]
    messages = "".join(message for assertion in failed for message in assertion["failureMessages"])
    u.require(len(failed) == 2 and regression["numPassedTests"] == 1 and
              all("sidebar-finite-width action" in assertion["fullName"] for assertion in failed) and
              "expected NaN to be 16" in messages and "Width NaN" in messages,
              "Baseline must reproduce the known regression in both policy and consuming sidebar")
    discovery = cli(app, releases, "discover")
    u.require(discovery["availableTargets"] == ["1.0.1"], "Target not discovered")
    approved = cli(app, releases, "plan", "--target", "1.0.1")
    plan_path = sandbox / "plan.json"
    plan_path.write_bytes(u.encode(approved))
    cli(app, releases, "apply", "--plan", str(plan_path))
    evidence = cli(app, releases, "verify", "--plan", str(plan_path))
    cli(app, releases, "audit")
    u.require(before == u.source_files(app), "Application/vendored bytes were overwritten")
    html = (app / ".next/server/app/dashboard.html").read_text()
    for expected in ["Northstar Dispatch", "Port of Oakland", "NS-104", "NS-105"]:
        u.require(expected in html, f"Built dashboard lost {expected}")
    u.require("Fresno cold storage" not in html, "Built dashboard offered unready freight")
    u.require((app / "public/northstar.svg").read_bytes() == (ROOT / "apps/demo/public/northstar.svg").read_bytes(),
              "Brand asset changed")
    report = {"schemaVersion": 1, "status": "verified", "discovery": discovery,
              "dependencyLockSha256": u.digest((ROOT / "bun.lock").read_bytes()),
              "baselineRegression": "failed-as-expected", "protectedFiles": len(before),
              "plan": approved, "evidence": evidence}
    (sandbox / "report.json").write_bytes(u.encode(report))
    print(f"Foundation canary verified: {sandbox / 'report.json'}")


if __name__ == "__main__":
    main()
