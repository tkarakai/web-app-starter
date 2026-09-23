"""Plain, deterministic tables (no terminal detection, colors or hidden links)."""
import re
import unicodedata

from .evidence import Event, newest


def clean(value) -> str:
    # Neutralize ANSI/OSC escapes, newlines and bidi controls from remote names.
    text = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", str(value if value is not None else "-"))
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    return " ".join("".join(c if not unicodedata.category(c).startswith("C") else " " for c in text).split()) or "-"


def table(headers: list[str], rows: list[list]) -> str:
    cells = [[clean(c) for c in row] for row in [headers, *rows]]
    widths = [max(len(row[i]) for row in cells) for i in range(len(headers))]
    lines = ["  ".join(c.ljust(widths[i]) for i, c in enumerate(row)).rstrip() for row in cells]
    lines.insert(1, "  ".join("-" * width for width in widths))
    return "\n".join(lines) + ("\n(no evidence in inspected window)" if not rows else "")


def when(value: str) -> str:
    return value[:16].replace("T", " ") if value else "-"


def short(sha: str | None) -> str:
    return sha[:12] if sha else "unknown"


def coverage_text(coverage: list[dict]) -> str:
    problems = [c for c in coverage if c["state"] != "complete"]
    unavailable = [c for c in problems if c["state"] in ("unavailable", "partial")]
    capped = [c for c in problems if c["state"] == "windowed"]
    lines = [f"Coverage: {len(unavailable)} unavailable/partial sources; {len(capped)} bounded windows. Not a complete audit."]
    groups = {}
    for item in unavailable:
        groups.setdefault(item["detail"], []).append(item["source"])
    for reason, sources in sorted(groups.items()):
        lines.append(f"  ! {clean(reason)} [{clean(', '.join(sorted(sources)))}]")
    if capped:
        lines.append("  ! History bounded by --limit (runs/tags/deployments) and --pages (API pages); details in --json.")
    return "\n".join(lines)


def overview(events: list[Event], apps: list[str]) -> str:
    builds = []
    deploys = []
    for app in apps:
        build = next((e for e in events if e.kind == "artifact" and e.app == app), None)
        ci = next((e for e in events if e.kind == "ci-build" and e.app == app), None)
        evidence = build or ci
        builds.append([app, when(evidence.time) if evidence else "-", short(evidence.sha) if evidence else "-",
                       build.name if build else "CI build only (not deployable)" if ci else "not observed",
                       evidence.state if evidence else "unknown"])
        for env in ("staging", "production"):
            observed = [e for e in events if e.app == app and e.environment == env and e.kind in ("vercel", "github-deployment")]
            latest = newest(observed)[0] if observed else None
            serving = next((e for e in observed if e.kind == "vercel" and e.current), None)
            deploys.append([app, env, when(latest.time) if latest else "-", short(latest.sha) if latest else "-",
                            latest.state if latest else "not observed", serving.id.removeprefix("vercel:") if serving else "unknown"])
    return ("Latest prebuilt uploads, or CI build if no upload observed (NOT deployments; UTC)\n" +
            table(["APP", "UPLOAD / CI START", "CHECKOUT SHA", "BUILD EVIDENCE", "STATE"], builds) +
            "\n\nLatest observed deployments (NOT necessarily serving; timestamps UTC)\n" +
            table(["APP", "ENVIRONMENT", "CREATED", "TARGET SHA", "STATE", "VERCEL SERVING ID"], deploys) +
            "\n\nRecent workflow runs\n" + table(["WORKFLOW", "STARTED", "TARGET SHA", "STATE", "SOURCE"],
              [[e.source, when(e.time), short(e.sha), e.state, e.url] for e in events if e.kind == "workflow" and e.source.startswith("cd-")][:3]) +
            "\n\nNo evidence != never built/deployed. Other apps may have CI builds but no prebuilt CD contract.\n"
            "Use history / candidates / --json for identifiers, full SHAs, links and evidence limitations.")


def history(events: list[Event], limit: int) -> str:
    sections = []
    for title, kinds in (("Prebuilt uploads (not deployments)", ("artifact",)),
                         ("Deployment chronology", ("vercel", "github-deployment", "deploy-job", "deploy-tag")),
                         ("CI builds, build/resolution jobs and workflows", ("ci-build", "build-resolve", "workflow")),
                         ("Starter source releases (not deployments)", ("release-tag",))):
        selected = [e for e in events if e.kind in kinds][:limit]
        rows = [[when(e.time), e.app or "repo/unknown", e.environment or "-", short(e.sha), e.kind,
                 e.state, e.name or e.id, e.source] for e in selected]
        sections.append(title + " (UTC)\n" + table(["TIME", "APP", "ENV", "SHA", "KIND", "STATE", "IDENTIFIER", "SOURCE"], rows))
        sections += [f"  {clean(e.id)}: {clean(e.url)}" for e in selected if e.url]
    sections.append("\nFull SHAs, status timestamps, relationships and caveats: --json. Artifact links by SHA/app do not prove reuse.")
    return "\n\n".join(sections)


def candidate_table(rows: list[dict]) -> str:
    summary = table(["FULL COMMIT SHA", "WORKFLOW GATES", "STAGING TAG (UTC)", "PRODUCTION TAG (UTC)"],
                    [[r["sha"], r["classification"], when(max(r["staging"], default="")),
                      when(max(r["production"], default=""))] for r in rows])
    details = []
    for row in rows:
        detail = [f"{row['sha']}: {'; '.join(row['reasons'])}"]
        for app, artifacts in row["artifacts"].items():
            detail.append(f"  {app}: " + (", ".join(f"{a['name']} ({a['state']}, uploaded {when(a['uploaded_at'])} UTC)" for a in artifacts)
                                           or "no same-checkout upload observed; reuse/build unresolved"))
        if row["release_tags"]:
            detail.append("  Source release tags: " + ", ".join(row["release_tags"]))
        if row["gate_url"]:
            detail.append("  CI evidence: " + row["gate_url"])
        details.append("\n".join(detail))
    return summary + "\n\n" + "\n\n".join(details) + (
        "\n\nGates-pass means a verified staging tag + current successful ci/gate-passed status ONLY.\n"
        "Not approval, safety, artifact provenance, all-app staging, or a serving-state guarantee.\n"
        "Production resolves by input hash and can build on a miss; landing is environment-specific.\n"
        "This command does not deploy anything. Use the existing cd-production.yml workflow after review.")
