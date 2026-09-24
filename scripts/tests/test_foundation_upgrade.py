"""Fast failure-contract tests; the full executable canary is test:foundation-canary."""
from pathlib import Path
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/foundation"))
import upgrade as u  # noqa: E402
from rehearse import copy_app, seed_baseline  # noqa: E402


class FoundationUpgradeTests(unittest.TestCase):
    def setUp(self):
        parent = ROOT / ".ci-local-artifacts"
        parent.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=parent, prefix="foundation-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.app = self.root / "demo"
        self.releases = self.root / "releases"
        copy_app(self.app)
        shutil.copytree(ROOT / "foundation/releases", self.releases)
        seed_baseline(self.app, self.releases)

    def plan(self):
        return u.plan(self.app, self.releases, "1.0.1")

    def assertBlocked(self, message, function, *args):
        with self.assertRaisesRegex(u.UpgradeError, message):
            function(*args)

    def change_catalogue(self, edit):
        path = self.releases / "catalogue.json"
        catalog = u.read_json(path)
        edit(catalog["releases"]["1.0.1"])
        path.write_bytes(u.encode(catalog))

    def test_current_upstream_and_demo_equal_immutable_target(self):
        expected = (ROOT / "foundation/releases/1.0.1" / u.PAYLOAD).read_bytes()
        self.assertEqual(expected, (ROOT / "packages/design-system/src/lib/sidebar-width.ts").read_bytes())
        self.assertEqual(expected, (ROOT / "apps/demo" / u.PAYLOAD).read_bytes())
        self.assertEqual(u.discover(ROOT / "apps/demo", ROOT / "foundation/releases")["current"], "1.0.1")

    def test_discovery_and_plan_are_deterministic_and_read_only(self):
        before = u.source_files(self.app)
        lock = (self.app / u.LOCK).read_bytes()
        self.assertEqual(u.discover(self.app, self.releases)["availableTargets"], ["1.0.1"])
        self.assertEqual(self.plan(), self.plan())
        self.assertEqual(before, u.source_files(self.app))
        self.assertEqual(lock, (self.app / u.LOCK).read_bytes())

    def test_apply_preserves_all_app_and_vendored_files_but_cannot_claim_done(self):
        approved = self.plan()
        before = u.source_files(self.app)
        self.assertEqual(u.apply(self.app, self.releases, approved)["status"], "pending")
        self.assertEqual(before, u.source_files(self.app))
        self.assertBlocked("unverified", u.audit, self.app, self.releases)
        self.assertBlocked("Incomplete", u.apply, self.app, self.releases, approved)

    def test_stale_plan_after_business_edit_is_refused_before_write(self):
        approved = self.plan()
        (self.app / "src/business/dispatch.ts").write_text("// downstream changed its rule\n")
        original = (self.app / u.PAYLOAD).read_bytes()
        self.assertBlocked("Stale", u.apply, self.app, self.releases, approved)
        self.assertEqual(original, (self.app / u.PAYLOAD).read_bytes())

    def test_edited_consumed_source_is_not_overwritten(self):
        (self.app / u.PAYLOAD).write_text("// intentional fork\n")
        self.assertBlocked("drift", self.plan)

    def test_unsupported_baseline_and_downgrade_are_refused(self):
        path = self.app / u.LOCK
        lock = u.read_json(path)
        lock["release"] = "0.9.0"
        path.write_bytes(u.encode(lock))
        self.assertBlocked("Unsupported baseline", self.plan)
        seed_baseline(self.app, self.releases)
        self.assertBlocked("Unsupported or stale", u.plan, self.app, self.releases, "1.0.0")

    def test_stale_baseline_metadata_is_refused(self):
        path = self.app / u.LOCK
        lock = u.read_json(path)
        lock["releaseDigest"] = "not-current"
        path.write_bytes(u.encode(lock))
        self.assertBlocked("Stale baseline", self.plan)

    def test_missing_or_unknown_action_is_not_silently_skipped(self):
        for value in [None, [], ["unknown-migration"]]:
            with self.subTest(value=value):
                self.change_catalogue(lambda release: release.update(actions=value))
                self.assertBlocked("action|Action", self.plan)

    def test_modified_plan_cannot_remove_checks_or_add_write_destinations(self):
        for field, value in [("actions", []), ("verification", []),
                             ("changes", [{"path": "src/business/dispatch.ts"}])]:
            approved = self.plan()
            approved[field] = value
            self.assertBlocked("modified", u.apply, self.app, self.releases, approved)

    def test_catalogue_cannot_overwrite_application_vendored_generated_or_escape(self):
        for path in ["src/business/dispatch.ts", "src/components/ui/sidebar.tsx", u.LOCK,
                     "../../outside", "/tmp/escape"]:
            with self.subTest(path=path):
                self.change_catalogue(lambda release: release.update(files={path: "bogus"}))
                self.assertBlocked("Unsafe overwrite", self.plan)

    def test_symlink_write_is_refused(self):
        path = self.app / u.PAYLOAD
        path.unlink()
        outside = self.root / "protected.ts"
        outside.write_text("protected")
        path.symlink_to(outside)
        self.assertBlocked("Symlink", self.plan)
        self.assertEqual(outside.read_text(), "protected")

    def test_hardlink_cannot_overwrite_app_owned_alias(self):
        os.link(self.app / u.PAYLOAD, self.app / "src/business/linked-policy.ts")
        self.assertBlocked("Hardlinked", self.plan)

    def test_generated_paths_cannot_be_reclassified_as_application(self):
        path = self.app / u.MANIFEST
        manifest = u.read_json(path)
        manifest["ownership"][".foundation/business.ts"] = "application"
        path.write_bytes(u.encode(manifest))
        self.assertBlocked("inside generated", self.plan)

    def test_unclassified_files_and_hidden_source_are_refused(self):
        (self.app / "unknown.ts").write_text("app code")
        self.assertBlocked("Unclassified", self.plan)
        path = self.app / u.MANIFEST
        manifest = u.read_json(path)
        manifest["ownership"]["unknown.ts"] = "generated"
        path.write_bytes(u.encode(manifest))
        self.assertBlocked("hidden", self.plan)

    def test_tampered_bundle_and_changed_catalogue_invalidate_plan(self):
        approved = self.plan()
        path = self.releases / "1.0.1" / u.PAYLOAD
        path.write_text("corrupted")
        self.assertBlocked("Corrupt", u.apply, self.app, self.releases, approved)

    def test_verify_without_apply_cannot_claim_completion(self):
        self.assertBlocked("Missing applied plan", u.verify, self.app, self.releases, self.plan())

    def test_failed_command_leaves_pending_lock_and_negative_evidence(self):
        approved = self.plan()
        u.apply(self.app, self.releases, approved)
        with patch.object(u.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)):
            self.assertBlocked("Verification failed", u.verify, self.app, self.releases, approved)
        self.assertEqual(u.read_json(self.app / u.LOCK)["status"], "pending")
        self.assertEqual(u.read_json(self.app / ".foundation/evidence.json")["status"], "failed")
        self.assertBlocked("unverified", u.audit, self.app, self.releases)

    def test_missing_build_artifact_blocks_even_if_commands_exit_zero(self):
        approved = self.plan()
        u.apply(self.app, self.releases, approved)
        # Even a stale artifact must not let a no-op build certify completion.
        stale = self.app / ".next/server/app/dashboard.html"
        stale.parent.mkdir(parents=True)
        stale.write_text("stale")
        with patch.object(u.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)):
            self.assertBlocked("Missing built", u.verify, self.app, self.releases, approved)
        self.assertEqual(u.read_json(self.app / u.LOCK)["status"], "pending")

    def test_missing_action_evidence_blocks_audit(self):
        approved = self.plan()
        u.apply(self.app, self.releases, approved)
        built = self.app / ".next/server/app/dashboard.html"
        built.parent.mkdir(parents=True)
        def fake_build(*_args, **_kwargs):
            built.write_text("fixture only: real build tested by rehearse.py")
            return subprocess.CompletedProcess([], 0)
        with patch.object(u.subprocess, "run", side_effect=fake_build):
            u.verify(self.app, self.releases, approved)
        self.assertEqual(u.audit(self.app, self.releases)["status"], "verified")
        path = self.app / ".foundation/evidence.json"
        evidence = u.read_json(path)
        evidence["results"].pop(0)
        path.write_bytes(u.encode(evidence))
        # Even a lock whose evidence hash was mechanically updated must not pass.
        lock = u.read_json(self.app / u.LOCK)
        lock["evidenceDigest"] = u.fingerprint(evidence)
        u.atomic_json(self.app / u.LOCK, lock)
        self.assertBlocked("Missing action", u.audit, self.app, self.releases)

    def test_source_mutation_during_verification_cannot_complete(self):
        approved = self.plan()
        u.apply(self.app, self.releases, approved)
        def mutate(*_args, **_kwargs):
            (self.app / "README.md").write_text("edited during verification")
            return subprocess.CompletedProcess([], 0)
        with patch.object(u.subprocess, "run", side_effect=mutate):
            self.assertBlocked("source changed", u.verify, self.app, self.releases, approved)

    def test_incomplete_copy_and_removed_action_cannot_verify(self):
        approved = self.plan()
        u.apply(self.app, self.releases, approved)
        (self.app / u.PAYLOAD).write_text("interrupted write")
        self.assertBlocked("Unverifiable installed", u.verify, self.app, self.releases, approved)
        (self.app / u.PAYLOAD).write_bytes((self.releases / "1.0.1" / u.PAYLOAD).read_bytes())
        stripped = copy.deepcopy(approved)
        stripped["actions"] = []
        stripped["id"] = u.fingerprint({key: value for key, value in stripped.items() if key != "id"})
        lock = u.read_json(self.app / u.LOCK)
        lock["plan"] = stripped
        u.atomic_json(self.app / u.LOCK, lock)
        self.assertBlocked("Missing action", u.verify, self.app, self.releases, stripped)

    def test_schema_mismatch_and_machine_readable_failure(self):
        path = self.app / u.MANIFEST
        value = u.read_json(path)
        value["schemaVersion"] = 999
        path.write_bytes(u.encode(value))
        command = [sys.executable, str(ROOT / "scripts/foundation/upgrade.py"), "discover",
                   "--app", str(self.app), "--releases", str(self.releases)]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stderr)["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
