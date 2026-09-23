"""Entry point: python3 -m scripts.ops.cli, or bun run ops."""
import argparse
import json
import sys

from .config import load_config
from .evidence import candidates, event_json, reconcile
from .render import candidate_table, clean, coverage_text, history, overview
from .sources import Collector, full_sha


def positive(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("Expected an integer from 1 to 100") from None
    if not 1 <= parsed <= 100:
        raise argparse.ArgumentTypeError("Expected an integer from 1 to 100")
    return parsed


def commit(value: str) -> str:
    parsed = full_sha(value)
    if not parsed:
        raise argparse.ArgumentTypeError("Use a full 40-character commit SHA; prefixes are ambiguous")
    return parsed


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Read-only GitHub/Vercel deployment evidence. See docs/operations-cli.md.")
    result.add_argument("view", nargs="?", default="overview", choices=("overview", "history", "candidates"))
    result.add_argument("--repo", help="GitHub OWNER/REPO (default: GH_REPO, config, origin)")
    result.add_argument("--config", help="JSON project mapping, no credentials")
    result.add_argument("--app", help="Filter one application (discovered from apps/ and config)")
    result.add_argument("--sha", type=commit, help="Exact commit; never inferred from short SHAs")
    result.add_argument("--limit", type=positive, default=10, help="Rows per history section / runs per workflow (default: 10)")
    result.add_argument("--pages", type=positive, default=3, help="Max pages per paginated source (default: 3)")
    result.add_argument("--no-vercel", action="store_true", help="Skip Vercel, visibly report missing evidence")
    result.add_argument("--json", action="store_true", help="Structured evidence with full SHA, links, coverage and caveats")
    return result


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        config = load_config(args.config, args.repo)
        if args.app and args.app not in config.apps:
            raise ValueError("Unknown --app; use an app directory name or configure its projects")
        apps = [args.app] if args.app else config.apps
        if args.app:
            config.apps = apps
        snapshot = Collector(config, args.limit, args.pages).collect(args.sha, args.no_vercel)
        events = reconcile(snapshot, apps)
        snapshot["coverage"] += [{"source": e.id, "state": "partial", "detail": note}
                                 for e in events for note in e.notes if "conflict" in note.lower()]
        snapshot["coverage"].sort(key=lambda c: (c["source"], c["state"], c["detail"]))
        selected = [e for e in events if (not args.sha or e.sha == args.sha) and (not args.app or e.app in (None, args.app))]
        rows = candidates(snapshot, events, apps, args.limit, args.sha)
        report = {"schema_version": 1, "repo": config.repo, "view": args.view,
                  "gathered_at": snapshot["gathered_at"], "coverage": snapshot["coverage"],
                  "events": [event_json(e) for e in selected], "candidates": rows,
                  "limitations": ["Bounded, non-atomic snapshot; absent evidence is not proof of absence",
                                  "Build/resolution job success does not prove a new build",
                                  "Short display SHAs are never used for joins; JSON and candidates carry full SHAs",
                                  "Dispatch head SHA and manifest github.sha can differ from checked-out/deployed SHA",
                                  "Artifacts are content-addressed; no reuse inferred from timestamp or same-checkout uploads",
                                  "No archive download, checksum/SLSA verification or live health checks"]}
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print(f"Operations evidence: {config.repo} | observed {snapshot['gathered_at']}\n")
            if args.view == "overview":
                print(overview(selected, apps))
            elif args.view == "history":
                print(history(selected, args.limit))
            else:
                print(candidate_table(rows))
            print("\n" + coverage_text(snapshot["coverage"]))
        # Partial data remains useful. Distinct exit status lets automation refuse
        # missing sources without losing the rendered evidence.
        return 2 if any(c["state"] in ("unavailable", "partial") for c in snapshot["coverage"]) else 0
    except (OSError, ValueError) as error:
        print("ops: " + clean(str(error)), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
