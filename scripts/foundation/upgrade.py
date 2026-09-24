#!/usr/bin/env python3
"""Offline, fail-closed source-snapshot rail. See docs/foundation-canary.md.

Release bundles are reviewed local code, not a remote command channel. Commands
are fixed here; plans cannot supply shell commands or writable destinations.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys

SCHEMA = 1
RAIL = "sidebar-width-snapshot"
PAYLOAD = "src/foundation/sidebar-width.ts"
LOCK = "foundation.lock.json"
MANIFEST = "foundation.json"
ACTIONS = {"sidebar-finite-width": ["bun", "run", "test:foundation"]}
CHECKS = {
    "business": ["bun", "run", "test:business"],
    "types": ["bun", "run", "typecheck"],
    "build": ["bun", "run", "build", "--webpack"],
}
OWNERS = {"consumed", "vendored", "application", "generated"}
# These alone are omitted from source fingerprints. Ownership labels do NOT
# grant permission to hide source under a user-defined generated rule.
GENERATED = ["node_modules/", ".next/", "out/", ".turbo/", ".foundation/", "next-env.d.ts", "tsconfig.tsbuildinfo"]


class UpgradeError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise UpgradeError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encode(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def fingerprint(value: object) -> str:
    return digest(encode(value))


def safe_path(root: Path, relative: str) -> Path:
    require(isinstance(relative, str) and bool(relative), "Empty/invalid path")
    path = PurePosixPath(relative)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in relative,
            f"Unsafe path: {relative}")
    require(str(path) == relative.rstrip("/"), f"Noncanonical path: {relative}")
    current = root
    require(root.absolute() == root.resolve(), f"Symlink root or ancestor: {root}")
    for part in path.parts:
        current = current / part
        require(not current.is_symlink(), f"Symlink path: {relative}")
        if current.is_file():
            require(current.stat().st_nlink == 1, f"Hardlinked path: {relative}")
    return current


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        raise UpgradeError(f"Cannot read JSON {path}: {error}") from error
    require(isinstance(value, dict), f"Expected object: {path}")
    require(type(value.get("schemaVersion")) is int and value["schemaVersion"] == SCHEMA,
            f"Unsupported schema: {path}")
    return value


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    require(not temporary.is_symlink(), f"Symlink temporary file: {temporary}")
    # Exclusive creation refuses stale files as well as symlink/hardlink aliases.
    with temporary.open("xb") as output:
        output.write(encode(value))
    os.replace(temporary, path)


def matches(path: str, rule: str) -> bool:
    return path.startswith(rule) if rule.endswith("/") else path == rule


def manifest(app: Path) -> dict:
    value = read_json(safe_path(app, MANIFEST))
    require(value.get("rail") == RAIL, "Unsupported rail")
    rules = value.get("ownership")
    require(isinstance(rules, dict) and bool(rules), "Missing ownership rules")
    for path, owner in rules.items():
        safe_path(app, path)
        require(owner in OWNERS, f"Unknown owner: {owner}")
    require(all(rules.get(path) == "generated" for path in GENERATED), "Generated paths are reserved")
    require(all(not any(matches(path, reserved) for reserved in GENERATED) or path in GENERATED
                for path in rules), "Cannot place source ownership inside generated paths")
    require(rules.get("src/foundation/") == "consumed", "Missing consumed boundary")
    require(all(owner != "consumed" or path == "src/foundation/" for path, owner in rules.items()),
            "Only src/foundation/ may be consumed on this rail")
    require(rules.get(LOCK) == "generated", "Lock must be generated")
    require(all(owner != "generated" or path in GENERATED + [LOCK] for path, owner in rules.items()),
            "Source cannot be hidden as generated")
    return value


def owner_of(value: dict, path: str) -> str:
    rules = [rule for rule in value["ownership"] if matches(path, rule)]
    require(bool(rules), f"Unclassified path: {path}")
    return value["ownership"][max(rules, key=len)]


def source_files(app: Path) -> dict[str, str]:
    value = manifest(app)
    result = {}
    for directory, dirs, files in os.walk(app, followlinks=False):
        parent = Path(directory)
        for name in list(dirs):
            path = (parent / name).relative_to(app).as_posix() + "/"
            if any(matches(path, rule) for rule in GENERATED):
                dirs.remove(name)
            else:
                safe_path(app, path)
        for name in files:
            path = (parent / name).relative_to(app).as_posix()
            if path == LOCK or any(matches(path, rule) for rule in GENERATED):
                continue
            file = safe_path(app, path)
            owner = owner_of(value, path)
            if owner != "consumed":
                result[path] = digest(file.read_bytes())
    return result


def installed(app: Path) -> dict[str, str]:
    root = safe_path(app, "src/foundation")
    require(root.is_dir(), "Missing consumed foundation")
    files = {}
    for path in root.rglob("*"):
        relative = path.relative_to(app).as_posix()
        safe_path(app, relative)
        if path.is_file():
            files[relative] = digest(path.read_bytes())
    return files


def catalogue(releases: Path) -> dict:
    value = read_json(safe_path(releases, "catalogue.json"))
    require(value.get("rail") == RAIL, "Catalogue rail mismatch")
    require(isinstance(value.get("releases"), dict) and bool(value["releases"]), "Missing releases")
    for version, release in value["releases"].items():
        require(isinstance(release, dict), "Invalid release")
        require(isinstance(release.get("files"), dict) and release["files"].keys() == {PAYLOAD},
                "Unsafe overwrite: unsupported release destinations")
        require(isinstance(release.get("from"), list) and
                all(isinstance(base, str) and base in value["releases"] for base in release["from"]),
                "Missing or unsupported baselines")
        require(isinstance(release.get("actions"), list) and
                all(isinstance(action, str) for action in release["actions"]),
                "Missing action/migration declaration")
        require(len(set(release["actions"])) == len(release["actions"]), "Duplicate action")
        require(all(action in ACTIONS for action in release["actions"]), "Unsupported action; upgrade the tooling")
        if release["from"]:
            require(bool(release["actions"]), "Missing action evidence requirement")
        for destination, sha in release["files"].items():
            payload = safe_path(releases, f"{version}/{destination}")
            require(payload.is_file() and digest(payload.read_bytes()) == sha, f"Corrupt release: {version}")
    require(value.get("latest") in value["releases"], "Unknown latest release")
    return value


def baseline(app: Path, catalog: dict) -> dict:
    lock = read_json(safe_path(app, LOCK))
    require(lock.get("rail") == RAIL, "Lock rail mismatch")
    require(lock.get("status") in {"baseline", "verified"}, "Incomplete upgrade; verify pending plan or restore from git")
    release = catalog["releases"].get(lock.get("release"))
    require(release is not None, "Unsupported baseline")
    require(lock.get("releaseDigest") == fingerprint(release), "Stale baseline release metadata")
    require(lock.get("files") == release["files"] == installed(app), "Consumed foundation drift; do not overwrite local edits")
    return lock


def discover(app: Path, releases: Path) -> dict:
    manifest(app)
    catalog = catalogue(releases)
    lock = baseline(app, catalog)
    targets = [version for version, release in catalog["releases"].items() if lock["release"] in release["from"]]
    return {"schemaVersion": SCHEMA, "rail": RAIL, "current": lock["release"],
            "availableTargets": targets, "latest": catalog["latest"]}


def plan(app: Path, releases: Path, target: str) -> dict:
    value = manifest(app)
    catalog = catalogue(releases)
    lock = baseline(app, catalog)
    require(target in catalog["releases"], "Unknown target")
    release = catalog["releases"][target]
    require(lock["release"] in release["from"], "Unsupported or stale baseline-to-target transition")
    for path in release["files"]:
        require(owner_of(value, path) == "consumed", f"Unsafe overwrite of {path}")
    result = {
        "schemaVersion": SCHEMA, "rail": RAIL, "from": lock["release"], "to": target,
        "catalogueDigest": fingerprint(catalog), "sourceDigest": fingerprint(source_files(app)),
        "toolDigest": digest(Path(__file__).read_bytes()),
        "lockDigest": fingerprint(lock),
        "changes": [{"path": path, "before": lock["files"][path], "after": sha}
                    for path, sha in sorted(release["files"].items())],
        "actions": [{"id": action, "command": ACTIONS[action]} for action in release["actions"]],
        "verification": [{"id": key, "command": command} for key, command in CHECKS.items()],
    }
    result["id"] = fingerprint(result)
    return result


def apply(app: Path, releases: Path, approved: dict) -> dict:
    require(approved == plan(app, releases, approved.get("to", "")), "Stale or modified upgrade plan")
    catalog = catalogue(releases)
    release = catalog["releases"][approved["to"]]
    # Pending is durable BEFORE touching consumed files. An interruption can never
    # look completed. Re-verify a fully copied tree, otherwise restore from git.
    pending = {"schemaVersion": SCHEMA, "rail": RAIL, "release": approved["to"],
               "releaseDigest": fingerprint(release), "files": release["files"],
               "status": "pending", "plan": approved}
    atomic_json(safe_path(app, LOCK), pending)
    for path in release["files"]:
        destination = safe_path(app, path)
        destination.write_bytes(safe_path(releases, f"{approved['to']}/{path}").read_bytes())
    return {"schemaVersion": SCHEMA, "status": "pending", "planId": approved["id"]}


def verification_context(app: Path, releases: Path, approved: dict) -> dict:
    catalog = catalogue(releases)
    lock = read_json(safe_path(app, LOCK))
    require(lock.get("status") in {"pending", "verified"} and lock.get("plan") == approved,
            "Missing applied plan; completion cannot be asserted")
    require(fingerprint(catalog) == approved.get("catalogueDigest"), "Catalogue changed since plan")
    require(digest(Path(__file__).read_bytes()) == approved.get("toolDigest"), "Upgrade tooling changed since plan")
    require(fingerprint(source_files(app)) == approved.get("sourceDigest"), "App-owned or vendored source changed since plan")
    release = catalog["releases"].get(approved.get("to"))
    require(release is not None and lock.get("release") == approved["to"] and
            lock.get("releaseDigest") == fingerprint(release) and
            lock.get("files") == release["files"] == installed(app), "Unverifiable installed target")
    require(approved.get("actions") == [{"id": action, "command": ACTIONS[action]} for action in release["actions"]],
            "Missing action/migration evidence requirement")
    require(approved.get("verification") == [{"id": key, "command": command} for key, command in CHECKS.items()],
            "Missing verification requirements")
    unsigned = {key: value for key, value in approved.items() if key != "id"}
    require(approved.get("id") == fingerprint(unsigned), "Invalid plan identity")
    return lock


def verify(app: Path, releases: Path, approved: dict) -> dict:
    lock = verification_context(app, releases, approved)
    # Re-verification invalidates any earlier success before a command runs.
    lock["status"] = "pending"
    lock.pop("evidenceDigest", None)
    atomic_json(safe_path(app, LOCK), lock)
    evidence = {"schemaVersion": SCHEMA, "rail": RAIL, "planId": approved["id"],
                "sourceDigest": approved["sourceDigest"], "release": approved["to"],
                "status": "failed", "results": []}
    evidence_path = safe_path(app, ".foundation/evidence.json")
    try:
        for check in approved["actions"] + approved["verification"]:
            if check["id"] == "build":
                # A successful no-op must not certify an old output as a new build.
                safe_path(app, ".next/server/app/dashboard.html").unlink(missing_ok=True)
            log = safe_path(app, f".foundation/{check['id']}.log")
            log.parent.mkdir(parents=True, exist_ok=True)
            with log.open("wb") as output:
                completed = subprocess.run(check["command"], cwd=app, stdout=output,
                                           stderr=subprocess.STDOUT, timeout=600, check=False,
                                           env={**os.environ, "NEXT_TELEMETRY_DISABLED": "1"})
            evidence["results"].append({**check, "exitCode": completed.returncode,
                                        "outputSha256": digest(log.read_bytes())})
            require(completed.returncode == 0, f"Verification failed: {check['id']}; see {log}")
        verification_context(app, releases, approved)
        artifact = safe_path(app, ".next/server/app/dashboard.html")
        require(artifact.is_file(), "Missing built dashboard artifact")
        evidence["artifacts"] = {".next/server/app/dashboard.html": digest(artifact.read_bytes())}
        evidence["status"] = "verified"
        atomic_json(evidence_path, evidence)
        lock["status"] = "verified"
        lock["evidenceDigest"] = fingerprint(evidence)
        atomic_json(safe_path(app, LOCK), lock)
        return evidence
    except (UpgradeError, OSError, subprocess.TimeoutExpired) as error:
        evidence["error"] = str(error)
        atomic_json(evidence_path, evidence)
        raise UpgradeError(str(error)) from error


def audit(app: Path, releases: Path) -> dict:
    """Check completion against this exact tree and retained executable evidence."""
    lock = read_json(safe_path(app, LOCK))
    require(lock.get("status") == "verified", "Completion is unverified")
    approved = lock.get("plan")
    require(isinstance(approved, dict), "Missing completion plan")
    verification_context(app, releases, approved)
    evidence = read_json(safe_path(app, ".foundation/evidence.json"))
    require(lock.get("evidenceDigest") == fingerprint(evidence) and evidence.get("status") == "verified" and
            evidence.get("rail") == RAIL and evidence.get("planId") == approved["id"] and
            evidence.get("sourceDigest") == approved["sourceDigest"] and evidence.get("release") == approved["to"],
            "Missing or altered completion evidence")
    artifacts = evidence.get("artifacts", {})
    require(isinstance(artifacts, dict) and artifacts.keys() == {".next/server/app/dashboard.html"},
            "Missing built artifact evidence")
    for path, sha in artifacts.items():
        artifact = safe_path(app, path)
        require(artifact.is_file() and digest(artifact.read_bytes()) == sha, "Built artifact changed or missing")
    expected = approved["actions"] + approved["verification"]
    results = evidence.get("results", [])
    require(len(results) == len(expected), "Missing action or verification evidence")
    for check, result in zip(expected, results):
        require(result.get("id") == check["id"] and result.get("command") == check["command"] and
                result.get("exitCode") == 0 and result.get("outputSha256") ==
                digest(safe_path(app, f".foundation/{check['id']}.log").read_bytes()),
                f"Unverifiable completion: {check['id']}")
    return evidence


@contextmanager
def exclusive(app: Path):
    guard = safe_path(app, ".foundation/upgrade.guard")
    guard.parent.mkdir(parents=True, exist_ok=True)
    with guard.open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise UpgradeError("Another upgrade command is active") from error
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def execute(args: argparse.Namespace) -> dict:
    if args.command == "discover":
        return discover(args.app, args.releases)
    if args.command == "plan":
        require(bool(args.target), "plan requires --target")
        return plan(args.app, args.releases, args.target)
    if args.command == "audit":
        return audit(args.app, args.releases)
    require(args.plan is not None, f"{args.command} requires --plan")
    approved = read_json(args.plan)
    return (apply if args.command == "apply" else verify)(args.app, args.releases, approved)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["discover", "plan", "apply", "verify", "audit"])
    parser.add_argument("--app", type=Path, default=Path("apps/demo"))
    parser.add_argument("--releases", type=Path, default=Path("foundation/releases"))
    parser.add_argument("--target")
    parser.add_argument("--plan", type=Path)
    args = parser.parse_args()
    try:
        with exclusive(args.app):
            result = execute(args)
        print(encode(result).decode(), end="")
        return 0
    except (UpgradeError, OSError, TypeError, KeyError, ValueError) as error:
        print(json.dumps({"schemaVersion": SCHEMA, "status": "blocked", "error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
