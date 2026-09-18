"""Run with: python3 -m unittest discover -s scripts/tests -v.

Exercises scripts/resolve-i18n-conflicts.py against real git merge conflicts in
real locale files, because the failure it exists to prevent — "keep both sides"
producing invalid JSON — is only visible in a genuine three-stage merge.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resolve_i18n", SCRIPTS / "resolve-i18n-conflicts.py"
)
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)

MESSAGES = "packages/i18n/messages"

BASE = {
    "common": {"appName": "Web App Starter", "save": "Save", "note": "Note"},
    "auth": {"signIn": "Sign in"},
}


def write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


class ResolveI18nConflictsTests(unittest.TestCase):
    """Builds a two-branch repo whose locale file conflicts, then resolves it."""

    def setUp(self):
        self.repo = Path(tempfile.mkdtemp(prefix="i18n-merge-"))
        self.addCleanup(shutil.rmtree, self.repo, ignore_errors=True)
        self.cwd = os.getcwd()
        self.addCleanup(os.chdir, self.cwd)

        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "Test")

        self.locale = self.repo / MESSAGES / "en.json"
        write(self.locale, BASE)
        self.git("add", "-A")
        self.git("commit", "-qm", "base")

        # upstream: a new platform namespace and a new key inside `common`
        self.git("checkout", "-q", "-b", "upstream")
        theirs = json.loads(json.dumps(BASE))
        theirs["common"]["securityNotice"] = "Security"
        theirs["security"] = {"title": "Security", "revoke": "Revoke"}
        write(self.locale, theirs)
        self.git("commit", "-qam", "upstream keys")

        # downstream: its own namespace, its own key, and a rebrand
        self.git("checkout", "-q", "main")
        ours = json.loads(json.dumps(BASE))
        ours["common"]["appName"] = "Northwind Fleet"
        ours["common"]["depot"] = "Depot"
        ours["fleet"] = {"title": "Fleet", "vehicles": "Vehicles"}
        write(self.locale, ours)
        self.git("commit", "-qam", "app keys")

        os.chdir(self.repo)

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.repo), *args], capture_output=True, text=True, check=True
        ).stdout

    def merge_upstream(self):
        result = subprocess.run(
            ["git", "-C", str(self.repo), "merge", "upstream"], capture_output=True, text=True
        )
        self.assertNotEqual(result.returncode, 0, "expected the locale file to conflict")
        return result

    def test_merges_both_sides_and_keeps_the_file_valid_json(self):
        self.merge_upstream()

        self.assertEqual(
            resolver.conflicted_message_files(), [f"{MESSAGES}/en.json"]
        )
        self.assertEqual(resolver.main([]), 0)

        merged = json.loads(self.locale.read_text())  # the whole point: still JSON

        # additions from both sides survive
        self.assertEqual(merged["fleet"], {"title": "Fleet", "vehicles": "Vehicles"})
        self.assertEqual(merged["security"], {"title": "Security", "revoke": "Revoke"})
        self.assertEqual(merged["common"]["depot"], "Depot")
        self.assertEqual(merged["common"]["securityNotice"], "Security")

        # a value only the app changed stays the app's
        self.assertEqual(merged["common"]["appName"], "Northwind Fleet")

        # untouched keys are untouched
        self.assertEqual(merged["auth"], {"signIn": "Sign in"})

        # and the file is staged, so `git commit` completes the merge
        staged = self.git("diff", "--name-only", "--cached")
        self.assertIn(f"{MESSAGES}/en.json", staged)

    def test_reports_keys_both_sides_changed_and_keeps_ours(self):
        # upstream edits a key the app also rebranded
        self.git("checkout", "-q", "upstream")
        theirs = json.loads(self.locale.read_text())
        theirs["common"]["appName"] = "Web App Starter Platform"
        write(self.locale, theirs)
        self.git("commit", "-qam", "upstream rebrand")
        self.git("checkout", "-q", "main")

        self.merge_upstream()
        self.assertEqual(resolver.main([]), 1)  # needs a human

        merged = json.loads(self.locale.read_text())
        self.assertEqual(merged["common"]["appName"], "Northwind Fleet")

    def test_check_mode_writes_nothing(self):
        self.merge_upstream()
        before = self.locale.read_text()

        self.assertEqual(resolver.main(["--check"]), 0)
        self.assertEqual(self.locale.read_text(), before)
        self.assertIn("<<<<<<<", before)

    def test_is_a_no_op_outside_a_merge(self):
        self.assertEqual(resolver.conflicted_message_files(), [])
        self.assertEqual(resolver.main([]), 0)


if __name__ == "__main__":
    unittest.main()
