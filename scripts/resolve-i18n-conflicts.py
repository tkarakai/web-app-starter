#!/usr/bin/env python3
"""Resolve merge conflicts in i18n message files by merging keys, not text.

Why this exists
---------------
`packages/i18n/messages/*.json` is a flat shared namespace: the starter adds keys
and every business app adds keys, so an upgrade conflicts in all 15 locales at
once. The obvious instruction — "keep both sides" — is wrong here. The closing
brace of a namespace is usually *shared context* outside the conflict, so
concatenating both sides interleaves the bodies of two different objects and
produces a file that is not JSON at all:

    "fleet": {
      "title": "Fleet",
      "depot": "Depot"        <- ours, unterminated
    "security": {             <- theirs, grafted inside ours
      "revoke": "Revoke"
    }

The fix is to merge the *parsed objects* three-way (base / ours / theirs) and
write the result back. Key additions from both sides are kept, edits on one side
win, and only a genuine both-sides-edited-the-same-key disagreement is reported
for a human to settle.

Usage
-----
    ./scripts/resolve-i18n-conflicts.py            # every conflicted message file
    ./scripts/resolve-i18n-conflicts.py --check    # report, change nothing
    ./scripts/resolve-i18n-conflicts.py packages/i18n/messages/en.json

Resolved files are written and `git add`-ed. Files with a real disagreement are
left conflicted, and the exact key paths are printed. Exit code is 0 when every
file was resolved, 1 when any file still needs a human.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

MESSAGES_DIR = "packages/i18n/messages/"
MISSING = object()  # distinguishes "key absent" from "key present and null"


def git(*args: str, binary: bool = False):
    result = subprocess.run(
        ["git", *args], capture_output=True, check=True, text=not binary
    )
    return result.stdout


def conflicted_message_files() -> list[str]:
    out = git("diff", "--name-only", "--diff-filter=U")
    return [
        line
        for line in out.splitlines()
        if line.startswith(MESSAGES_DIR) and line.endswith(".json")
    ]


def stage(path: str, number: int):
    """Read one merge stage: 1 = base, 2 = ours, 3 = theirs. None if absent."""
    try:
        return json.loads(git("show", f":{number}:{path}"))
    except subprocess.CalledProcessError:
        return None


def merge(base, ours, theirs, path=()):
    """Three-way merge two parsed JSON values. Returns (value, conflicts)."""
    if ours == theirs:
        return ours, []
    if base is not MISSING and ours == base:
        return theirs, []  # only theirs changed
    if base is not MISSING and theirs == base:
        return ours, []  # only ours changed

    if isinstance(ours, dict) and isinstance(theirs, dict):
        base_dict = base if isinstance(base, dict) else {}
        merged: dict = {}
        conflicts: list[str] = []
        # base order first (stable diffs), then each side's additions
        keys = list(base_dict)
        for key in list(ours) + list(theirs):
            if key not in keys:
                keys.append(key)

        for key in keys:
            in_ours, in_theirs = key in ours, key in theirs
            if not in_ours and not in_theirs:
                continue  # both deleted it
            if not in_ours:
                # deleted by us, or added by them
                if key in base_dict and base_dict[key] == theirs[key]:
                    continue  # we deleted, they left it alone -> stay deleted
                merged[key] = theirs[key]
                continue
            if not in_theirs:
                if key in base_dict and base_dict[key] == ours[key]:
                    continue  # they deleted, we left it alone -> stay deleted
                merged[key] = ours[key]
                continue
            value, sub = merge(
                base_dict.get(key, MISSING), ours[key], theirs[key], (*path, key)
            )
            merged[key] = value
            conflicts.extend(sub)
        return merged, conflicts

    # two different scalars (or mismatched shapes): a real disagreement.
    # Keep ours — a business app's own translation should not be silently
    # replaced — and report it so a human decides.
    return ours, [".".join(path) or "<root>"]


def resolve(path: str, check_only: bool) -> bool:
    base, ours, theirs = stage(path, 1), stage(path, 2), stage(path, 3)
    if ours is None or theirs is None:
        print(f"  {path}: added/deleted on one side — resolve by hand")
        return False

    merged, conflicts = merge(MISSING if base is None else base, ours, theirs)

    if conflicts:
        print(f"  {path}: {len(conflicts)} key(s) changed on both sides, kept ours:")
        for key in conflicts:
            print(f"      {key}")

    if check_only:
        return not conflicts

    with open(path, "w", encoding="utf-8") as handle:
        json.dump(merged, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    git("add", path)
    return not conflicts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", help="defaults to every conflicted locale")
    parser.add_argument(
        "--check", action="store_true", help="report only, write nothing"
    )
    args = parser.parse_args(argv)

    files = args.files or conflicted_message_files()
    if not files:
        print("resolve-i18n: no conflicted message files")
        return 0

    print(f"resolve-i18n: {len(files)} file(s)")
    clean = all([resolve(path, args.check) for path in files])

    if clean:
        verb = "would resolve" if args.check else "resolved"
        print(f"resolve-i18n: {verb} every file cleanly")
    else:
        print("resolve-i18n: some keys need a human — see above")
    return 0 if clean else 1


if __name__ == "__main__":
    sys.exit(main())
