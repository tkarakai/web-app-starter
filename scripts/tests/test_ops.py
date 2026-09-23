"""Offline contract tests: bun run test:ops (also included in test:dev-scripts)."""
from contextlib import redirect_stdout, redirect_stderr
from copy import deepcopy
from io import StringIO
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.ops.cli import main, parser
from scripts.ops.config import Config, load_config
from scripts.ops.evidence import candidates, reconcile, safe_url
from scripts.ops.render import candidate_table, clean, coverage_text, history, overview, table
from scripts.ops.sources import Collector, SourceError, github_get, tag_time, vercel_get

FIXTURE = json.loads((Path(__file__).parent / "fixtures/ops-evidence.json").read_text())
A = "abcdef0123451111111111111111111111111111"
B = "abcdef0123452222222222222222222222222222"
APPS = ["web", "admin", "landing"]


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = deepcopy(FIXTURE)

    def events(self):
        return {e.id: e for e in reconcile(self.snapshot, APPS)}

    def test_dispatch_target_not_workflow_head(self):
        events = self.events()
        self.assertEqual(events["run:20"].sha, A)
        self.assertEqual(events["run:20"].context_sha, B)
        self.assertEqual(events["artifact:3"].sha, A)
        self.assertIsNone(events["run:40"].sha)
        self.assertIsNone(events["artifact:4"].sha)
        self.assertIsNone(events["github-deployment:502"].sha)

    def test_exact_url_join_and_latest_github_status(self):
        events = self.events()
        dep = events["github-deployment:501"]
        self.assertEqual(dep.sha, A)
        self.assertEqual(dep.context_sha, B)
        self.assertEqual(dep.app, "web")
        self.assertEqual(dep.state, "inactive")
        self.assertEqual(dep.time, "2026-09-21T13:03:00.000Z")
        self.assertIn("vercel:dpl_prod", dep.related)
        self.assertIn(dep.id, events["vercel:dpl_prod"].related)
        self.assertTrue(events["vercel:dpl_prod"].current)

    def test_full_sha_and_app_join_no_short_prefix_or_cross_app_match(self):
        events = self.events()
        self.assertIn("artifact:1", events["vercel:dpl_prod"].related)
        self.assertNotIn("artifact:2", events["vercel:dpl_prod"].related)
        self.assertNotIn("artifact:1", events["vercel:dpl_staging"].related)
        self.assertEqual(A[:12], B[:12])

    def test_new_build_not_inferred_from_resolve_job(self):
        events = self.events()
        self.assertEqual(events["job:201"].kind, "build-resolve")
        self.assertEqual(len([e for e in events.values() if e.kind == "artifact"]), 4)
        self.assertNotIn("artifact:5", events)
        self.assertNotIn("artifact:6", events)

    def test_artifact_expiry_checked_against_observation_time(self):
        self.assertEqual(self.events()["artifact:1"].state, "available")
        self.assertEqual(self.events()["artifact:2"].state, "expired")
        self.snapshot["artifacts"][0]["expired"] = True
        self.assertEqual(self.events()["artifact:1"].state, "expired")

    def test_missing_expiry_does_not_claim_available(self):
        del self.snapshot["artifacts"][0]["expires_at"]
        self.assertEqual(self.events()["artifact:1"].state, "unknown")

    def test_staging_is_project_mapping_not_vercel_target(self):
        events = self.events()
        self.assertEqual(events["vercel:dpl_staging"].environment, "staging")
        self.assertEqual(events["vercel:dpl_prod"].environment, "production")

    def test_missing_metadata_and_new_failed_deploy_not_assumed_serving(self):
        events = self.events()
        self.assertIsNone(events["vercel:dpl_failed"].sha)
        self.assertFalse(events["vercel:dpl_failed"].current)
        text = overview(list(events.values()), APPS)
        self.assertIn("dpl_prod", text)
        self.assertIn("ERROR", text)

    def test_conflicting_sources_not_silently_reconciled(self):
        self.snapshot["vercel"][1]["deployment"]["meta"]["githubCommitSha"] = B
        events = self.events()
        self.assertIsNone(events["github-deployment:501"].sha)
        self.assertTrue(any("CONFLICT" in n for n in events["vercel:dpl_prod"].notes))

    def test_conflicting_or_foreign_metadata_withheld(self):
        meta = self.snapshot["vercel"][1]["deployment"]["meta"]
        meta["gitCommitSha"] = B
        self.assertIsNone(self.events()["vercel:dpl_prod"].sha)
        del meta["gitCommitSha"]
        meta.update(githubCommitOrg="other", githubCommitRepo="repo")
        self.assertIsNone(self.events()["vercel:dpl_prod"].sha)

    def test_ordering_independent_of_response_order(self):
        before = reconcile(self.snapshot, APPS)
        for field in ("runs", "artifacts", "jobs", "tags", "deployments", "vercel"):
            self.snapshot[field].reverse()
        self.assertEqual([e.id for e in before], [e.id for e in reconcile(self.snapshot, APPS)])
        self.assertGreaterEqual(before[0].time, before[1].time)

    def test_ci_build_evidence_does_not_imply_deployable_artifact(self):
        self.snapshot["jobs"].append({"id": 777, "run_id": 10, "name": "ci-web / Build & Bundle Size",
                                      "conclusion": "failure", "steps": [{"name": "Build", "conclusion": "success",
                                      "started_at": "2026-09-20T11:30:00Z", "completed_at": "2026-09-20T11:32:00Z"}]})
        event = self.events()["ci-build:777"]
        self.assertEqual(event.sha, A)
        self.assertEqual(event.state, "success")
        self.assertEqual(event.updated_at, "2026-09-20T11:32:00.000Z")
        self.assertIsNone(event.environment)

    def test_pr_ci_checkout_not_inferred_from_head_sha(self):
        self.snapshot["runs"].append({"id": 99, "path": ".github/workflows/ci-storybook.yml", "event": "pull_request", "head_sha": A})
        self.snapshot["jobs"].append({"id": 999, "run_id": 99, "name": "Build", "conclusion": "success"})
        events = reconcile(self.snapshot, APPS + ["storybook"])
        event = next(e for e in events if e.id == "ci-build:999")
        self.assertIsNone(event.sha)
        self.assertEqual(event.context_sha, A)

    def test_subsecond_ordering_is_normalized(self):
        self.snapshot["artifacts"][0]["created_at"] = "2026-09-20T12:02:00.100Z"
        self.snapshot["artifacts"][1]["created_at"] = "2026-09-20T12:02:00Z"
        ids = [e.id for e in reconcile(self.snapshot, APPS)]
        self.assertLess(ids.index("artifact:1"), ids.index("artifact:2"))

    def test_release_is_not_a_deployment(self):
        release = self.events()["tag:v1.2.0"]
        self.assertEqual(release.kind, "release-tag")
        self.assertIsNone(release.environment)

    def test_candidates_require_gates_not_artifacts_or_workflow_success(self):
        rows = {r["sha"]: r for r in candidates(self.snapshot, list(self.events().values()), APPS, 10)}
        self.assertEqual(rows[A]["classification"], "gates-pass")
        self.assertEqual(rows[B]["classification"], "blocked")
        self.assertEqual(rows[A]["artifacts"]["admin"][0]["state"], "expired")
        self.assertEqual(rows[B]["artifacts"]["web"], [])
        self.assertEqual(rows[A]["release_tags"], ["v1.2.0"])
        self.assertIn("Gates only", rows[A]["limitations"][0])

    def test_candidate_without_tag_or_status_is_not_eligible(self):
        self.snapshot["tags"] = []
        events = reconcile(self.snapshot, APPS)
        rows = candidates(self.snapshot, events, APPS, 10, A)
        self.assertEqual(rows[0]["classification"], "insufficient-evidence")
        self.snapshot["gates"] = {}
        self.assertEqual(candidates(self.snapshot, events, APPS, 10, A)[0]["classification"], "insufficient-evidence")

    def test_partial_sources_still_provide_evidence(self):
        self.snapshot["vercel"] = []
        events = self.events()
        self.assertEqual(events["github-deployment:501"].sha, A)
        self.assertIsNone(events["github-deployment:501"].current)
        self.assertEqual(events["artifact:1"].sha, A)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.config = Config("example/starter", APPS, {})

    def test_complete_collection_with_provider_shaped_fixture(self):
        fixture = deepcopy(FIXTURE)
        tag_details = {}
        refs = []
        for index, tag in enumerate(fixture["tags"], 1):
            oid = str(index) * 40
            refs.append({"ref": "refs/tags/" + tag["name"], "object": {"type": "tag", "sha": oid}})
            tag_details[oid] = {"object": {"type": "commit", "sha": tag["sha"]},
                                "message": f"Workflow run: https://github.com/example/starter/actions/runs/{tag['run_id']}"}
        def gh(path):
            resource, _, query = path.removeprefix("repos/example/starter/").partition("?")
            if resource.startswith("git/matching-refs/tags/"):
                prefix = "refs/tags/" + resource.removeprefix("git/matching-refs/tags/")
                return [r for r in refs if r["ref"].startswith(prefix)]
            if resource.startswith("git/tags/"):
                return tag_details[resource.rsplit("/", 1)[-1]]
            if resource.startswith("actions/workflows/"):
                workflow = resource.split("/")[2]
                rows = [r for r in fixture["runs"] if r["path"].endswith("/" + workflow)]
                return {"workflow_runs": rows, "total_count": len(rows)}
            if resource.startswith("actions/runs/"):
                run_id = int(resource.split("/")[2])
                if resource.endswith("/jobs"):
                    rows = [j for j in fixture["jobs"] if j["run_id"] == run_id]
                    return {"jobs": rows, "total_count": len(rows)}
                if resource.endswith("/artifacts"):
                    rows = [a for a in fixture["artifacts"] if a["workflow_run"]["id"] == run_id]
                    return {"artifacts": rows, "total_count": len(rows)}
                return next(r for r in fixture["runs"] if r["id"] == run_id)
            if resource == "actions/artifacts":
                return {"artifacts": fixture["artifacts"], "total_count": len(fixture["artifacts"])}
            if resource == "deployments":
                return fixture["deployments"] if "environment=production" in query else []
            if resource.startswith("deployments/"):
                return next(d["statuses"] for d in fixture["deployments"] if str(d["id"]) == resource.split("/")[1])
            if resource.startswith("commits/"):
                return {"statuses": [{"context": "ci/gate-passed", **fixture["gates"][resource.split("/")[1]]}], "total_count": 1}
            self.fail("Unexpected endpoint: " + path)
        collector = Collector(self.config, 10, 3, gh=gh)
        snapshot = collector.collect(no_vercel=True)
        self.assertEqual(len(snapshot["artifacts"]), 6)  # deduplicated across run + repo inventory
        events = reconcile(snapshot, APPS)
        rows = {r["sha"]: r for r in candidates(snapshot, events, APPS, 10)}
        self.assertEqual(rows[A]["classification"], "gates-pass")
        self.assertEqual(rows[B]["classification"], "blocked")
        self.assertEqual(next(e for e in events if e.id == "artifact:3").sha, A)

    def test_pagination_order_and_window_reporting(self):
        paths = []
        def gh(path):
            paths.append(path)
            return {"items": [{"id": len(paths)}], "total_count": 4}
        collector = Collector(self.config, 10, 2, gh=gh)
        self.assertEqual(collector.listing("actions/artifacts", "artifacts", "items", 1), [{"id": 1}, {"id": 2}])
        self.assertTrue(paths[1].endswith("per_page=1&page=2"))
        self.assertEqual(collector.coverage[-1]["state"], "windowed")

    def test_partial_page_failure_preserves_first_page(self):
        def gh(path):
            if "page=2" in path:
                raise SourceError("rate limited")
            return [1]
        collector = Collector(self.config, 10, 3, gh=gh)
        self.assertEqual(collector.listing("test", "test", page_size=1), [1])
        self.assertEqual(collector.coverage[-1]["state"], "unavailable")

    def test_repeated_page_stops(self):
        collector = Collector(self.config, 10, 3, gh=lambda path: [1])
        self.assertEqual(collector.listing("test", "test", page_size=1), [1])
        self.assertEqual(collector.coverage[-1]["state"], "partial")

    def test_annotated_tag_dereferenced_not_object_sha(self):
        ref = {"ref": f"refs/tags/deploy/staging/2026-09-20T12-05-00Z/{A}", "object": {"type": "tag", "sha": B}}
        def gh(path):
            return [ref] if "matching-refs" in path else {"object": {"type": "commit", "sha": A}, "message": "Workflow run: https://github.com/example/starter/actions/runs/10"}
        collector = Collector(self.config, 10, 3, gh=gh)
        tag = collector.tags("deploy/", None)[0]
        self.assertEqual(tag["sha"], A)
        self.assertEqual(tag["run_id"], 10)
        self.assertEqual(tag["time"], "2026-09-20T12:05:00Z")

    def test_tag_window_keeps_production_even_when_staging_is_busier(self):
        refs = [{"ref": f"refs/tags/deploy/staging/2026-09-2{i}T12-05-00Z/{A}",
                 "object": {"type": "commit", "sha": A}} for i in range(1, 5)]
        refs += [{"ref": f"refs/tags/deploy/production/2026-09-01T12-05-00Z/{A}",
                  "object": {"type": "commit", "sha": A}}]
        collector = Collector(self.config, 1, 3, gh=lambda path: refs)
        tags = collector.tags("deploy/", None)
        self.assertEqual(len(tags), 2)
        self.assertTrue(any(t["name"].startswith("deploy/production/") for t in tags))
        self.assertEqual(collector.coverage[-1]["state"], "windowed")

    def test_misnamed_tag_rejected(self):
        ref = {"ref": f"refs/tags/deploy/staging/2026-09-20T12-05-00Z/{A}", "object": {"type": "commit", "sha": B}}
        collector = Collector(self.config, 10, 3, gh=lambda path: [ref])
        self.assertEqual(collector.tags("deploy/", None), [])
        self.assertEqual(collector.coverage[-1]["state"], "partial")

    def test_rollback_tag_timestamp(self):
        self.assertEqual(tag_time(f"refs/tags/deploy/staging/rollback/2026-09-20T12-05-00Z/{A}"), "2026-09-20T12:05:00Z")

    def test_vercel_cursor_and_old_current_target(self):
        paths = []
        def vercel(path):
            paths.append(path)
            if "/projects/" in path:
                return {"targets": {"production": {"id": "dpl_old", "createdAt": 1, "url": "old.vercel.app"}}}
            if "until=" in path:
                return {"deployments": [], "pagination": {"next": None}}
            return {"deployments": [{"uid": "dpl_new", "state": "ERROR"}], "pagination": {"next": 10}}
        config = Config("example/starter", ["web"], {"web": {"staging": "prj_stage"}}, "team_test")
        collector = Collector(config, 10, 3, vercel=vercel)
        rows = collector.collect_vercel(False)
        self.assertTrue(any("until=10" in p and "teamId=team_test" in p for p in paths))
        self.assertFalse(rows[0]["current"])
        self.assertTrue(rows[1]["current"])
        self.assertEqual(rows[1]["deployment"]["uid"], "dpl_old")

    def test_project_current_survives_failed_listing(self):
        def vercel(path):
            if "/projects/" in path:
                return {"targets": {"production": {"id": "dpl_old", "url": "https://old.vercel.app"}}}
            raise SourceError("rate limited")
        config = Config("example/starter", ["web"], {"web": {"production": "prj_prod"}})
        collector = Collector(config, 10, 3, vercel=vercel)
        rows = collector.collect_vercel(False)
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["current"])
        snapshot = {**FIXTURE, "vercel": rows}
        event = next(e for e in reconcile(snapshot, APPS) if e.id == "vercel:dpl_old")
        self.assertEqual(event.url, "https://old.vercel.app")

    def test_missing_vercel_token_is_visible(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(SourceError, "VERCEL_TOKEN not set"):
                vercel_get("/v7/deployments")

    def test_github_transport_get_only_and_hides_stderr(self):
        with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, '{"ok":true}', "secret")) as run:
            self.assertEqual(github_get("repos/example/starter"), {"ok": True})
            self.assertEqual(run.call_args.args[0], ["gh", "api", "--method", "GET", "repos/example/starter"])
        with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 1, "", "TOKEN-secret")):
            with self.assertRaises(SourceError) as raised:
                github_get("repos/example/starter")
            self.assertNotIn("TOKEN-secret", str(raised.exception))

    def test_all_github_sources_unavailable_does_not_prevent_vercel(self):
        def failed(path):
            raise SourceError("offline")
        collector = Collector(self.config, 1, 1, gh=failed)
        with patch.object(collector, "collect_vercel", return_value=FIXTURE["vercel"]):
            snapshot = collector.collect()
        self.assertEqual(len(snapshot["vercel"]), 3)
        self.assertTrue(any(c["state"] == "unavailable" for c in snapshot["coverage"]))


class RenderingAndCliTests(unittest.TestCase):
    def test_table_golden(self):
        self.assertEqual(table(["APP", "STATE"], [["web", "READY"], ["admin", "ERROR"]]),
                         "APP    STATE\n-----  -----\nweb    READY\nadmin  ERROR")
        self.assertIn("no evidence", table(["APP"], []))

    def test_terminal_controls_and_sensitive_url_parts_removed(self):
        self.assertEqual(clean("\x1b[31mERROR\x1b[0m\nnext\u202e"), "ERROR next")
        self.assertEqual(safe_url("https://example.com/path?token=secret#secret"), "https://example.com/path")
        self.assertEqual(safe_url("https://user:secret@example.com"), "")
        self.assertEqual(safe_url("https://["), "")

    def test_history_and_candidate_tables_expose_evidence_limits(self):
        events = reconcile(FIXTURE, APPS)
        text = history(events, 10)
        self.assertIn("Prebuilt uploads (not deployments)", text)
        self.assertIn("https://github.com/example/starter/actions/runs/10/artifacts/1", text)
        text = candidate_table(candidates(FIXTURE, events, APPS, 10))
        self.assertIn(A, text)
        self.assertIn("gates-pass", text)
        self.assertIn("Not approval", text)
        self.assertIn("no same-checkout upload observed", text)
        self.assertIn("not a complete audit", coverage_text([]).lower())

    def test_cli_does_not_accept_mutations_or_short_shas(self):
        for argv in (["deploy"], ["history", "--sha", A[:12]], ["--pages", "0"], ["--limit", "101"]):
            with redirect_stderr(StringIO()), self.assertRaises(SystemExit):
                parser().parse_args(argv)

    def test_json_partial_exit_code_and_filter(self):
        snapshot = deepcopy(FIXTURE)
        snapshot["coverage"] = [{"source": "Vercel", "state": "unavailable", "detail": "offline"}]
        out = StringIO()
        with patch("scripts.ops.cli.load_config", return_value=Config("example/starter", APPS, {})), patch("scripts.ops.cli.Collector.collect", return_value=snapshot), redirect_stdout(out):
            code = main(["history", "--json", "--sha", A, "--app", "web"])
        report = json.loads(out.getvalue())
        self.assertEqual(code, 2)
        self.assertEqual(report["schema_version"], 1)
        self.assertTrue(all(e["sha"] == A for e in report["events"]))
        self.assertTrue(all(e["app"] in (None, "web") for e in report["events"]))
        self.assertNotIn("meta", report["events"][0])

    def test_conflicting_sources_visible_in_default_output_and_exit_code(self):
        snapshot = deepcopy(FIXTURE)
        snapshot["vercel"][1]["deployment"]["meta"]["githubCommitSha"] = B
        out = StringIO()
        with patch("scripts.ops.cli.load_config", return_value=Config("example/starter", APPS, {})), patch("scripts.ops.cli.Collector.collect", return_value=snapshot), redirect_stdout(out):
            code = main([])
        self.assertEqual(code, 2)
        self.assertIn("CONFLICT", out.getvalue())
        self.assertIn("partial", out.getvalue())

    def test_configuration_uses_repository_and_secret_variable_names(self):
        with patch.dict(os.environ, {"GH_REPO": "example/starter", "VERCEL_ORG_ID": "team_test", "VERCEL_PROJECT_ID_WEB_STAGING": "prj_stage"}, clear=True):
            config = load_config(None, None)
        self.assertEqual(config.repo, "example/starter")
        self.assertEqual(config.projects["web"]["staging"], "prj_stage")
        self.assertIn("landing-static", config.apps)

    def test_config_rejects_credentials_without_echoing_them(self):
        with patch("pathlib.Path.read_text", return_value='{"token":"do-not-print"}'):
            with self.assertRaises(ValueError) as raised:
                load_config("config.json", "example/starter")
        self.assertNotIn("do-not-print", str(raised.exception))

    def test_duplicate_project_mapping_rejected(self):
        with patch.dict(os.environ, {"VERCEL_PROJECT_ID_WEB_STAGING": "prj_same", "VERCEL_PROJECT_ID_WEB": "prj_same"}, clear=True):
            with self.assertRaisesRegex(ValueError, "only one"):
                load_config(None, "example/starter")


if __name__ == "__main__":
    unittest.main()
