/** Deterministic plain tables, with terminal controls neutralized. */
import { stripVTControlCharacters } from "node:util";
import { newest, ofKind } from "./evidence.js";
import type { Candidate, Coverage, Evidence, Kind } from "./types.js";
export function clean(value: unknown): string {
  return (
    stripVTControlCharacters(String(value ?? "-"))
      .replace(/\p{C}/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .join(" ") || "-"
  );
}
export function table(headers: string[], rows: unknown[][]): string {
  const cells = [headers, ...rows].map((row) => row.map(clean));
  const widths = headers.map((_, i) =>
    Math.max(...cells.map((row) => row[i].length)),
  );
  const lines = cells.map((row) =>
    row
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd(),
  );
  lines.splice(1, 0, widths.map((width) => "-".repeat(width)).join("  "));
  return (
    lines.join("\n") +
    (rows.length ? "" : "\n(no evidence in inspected window)")
  );
}
export const when = (value?: string): string =>
  value ? value.slice(0, 16).replace("T", " ") : "-";
export const short = (sha: string | null): string =>
  sha?.slice(0, 12) || "unknown";
export function coverageText(coverage: Coverage[]): string {
  const missing = coverage.filter((c) =>
    ["unavailable", "partial"].includes(c.state),
  );
  const capped = coverage.filter((c) => c.state === "windowed");
  const lines = [
    `Coverage: ${missing.length} unavailable/partial sources; ${capped.length} bounded windows. Not a complete audit.`,
  ];
  const groups = new Map<string, string[]>();
  for (const item of missing)
    groups.set(item.detail, [...(groups.get(item.detail) ?? []), item.source]);
  for (const reason of [...groups.keys()].sort())
    lines.push(
      `  ! ${clean(reason)} [${clean(groups.get(reason)!.sort().join(", "))}]`,
    );
  if (capped.length)
    lines.push(
      "  ! History bounded by --limit (runs/tags/deployments) and --pages (API pages); details in --json.",
    );
  return lines.join("\n");
}
export function overview(events: Evidence[], apps: string[]): string {
  const builds: unknown[][] = [];
  const deploys: unknown[][] = [];
  for (const app of apps) {
    const build = events.find((e) => e.kind === "artifact" && e.app === app);
    const ci = events.find((e) => e.kind === "ci-build" && e.app === app);
    const evidence = build || ci;
    builds.push([
      app,
      when(evidence?.time),
      evidence ? short(evidence.sha) : "-",
      build?.name || (ci ? "CI build only (not deployable)" : "not observed"),
      evidence?.state || "unknown",
    ]);
    for (const env of ["staging", "production"]) {
      const observed = events.filter(
        (e) =>
          e.app === app &&
          e.environment === env &&
          ["vercel", "github-deployment"].includes(e.kind),
      );
      const latest = newest(observed)[0];
      const serving = observed.find((e) => e.kind === "vercel" && e.current);
      deploys.push([
        app,
        env,
        when(latest?.time),
        latest ? short(latest.sha) : "-",
        latest?.state || "not observed",
        serving?.id.replace(/^vercel:/, "") || "unknown",
      ]);
    }
  }
  return (
    "Latest prebuilt uploads, or CI build if no upload observed (NOT deployments; UTC)\n" +
    table(
      ["APP", "UPLOAD / CI START", "CHECKOUT SHA", "BUILD EVIDENCE", "STATE"],
      builds,
    ) +
    "\n\nLatest observed deployments (NOT necessarily serving; timestamps UTC)\n" +
    table(
      [
        "APP",
        "ENVIRONMENT",
        "CREATED",
        "TARGET SHA",
        "STATE",
        "VERCEL SERVING ID",
      ],
      deploys,
    ) +
    "\n\nRecent workflow runs\n" +
    table(
      ["WORKFLOW", "STARTED", "TARGET SHA", "STATE", "SOURCE"],
      events
        .filter((e) => e.kind === "workflow" && e.source.startsWith("cd-"))
        .slice(0, 3)
        .map((e) => [e.source, when(e.time), short(e.sha), e.state, e.url]),
    ) +
    "\n\nNo evidence != never built/deployed. Other apps may have CI builds but no prebuilt CD contract.\nUse history / candidates / --json for identifiers, full SHAs, links and evidence limitations."
  );
}
export function history(events: Evidence[], limit: number): string {
  const sections: string[] = [];
  const groups: [string, Kind[]][] = [
    ["Prebuilt uploads (not deployments)", ["artifact"]],
    [
      "Deployment chronology",
      ["vercel", "github-deployment", "deploy-job", "deploy-tag"],
    ],
    [
      "CI builds, build/resolution jobs and workflows",
      ["ci-build", "build-resolve", "workflow"],
    ],
    ["Starter source releases (not deployments)", ["release-tag"]],
  ];
  for (const [title, kinds] of groups) {
    const selected = ofKind(events, kinds).slice(0, limit);
    sections.push(
      `${title} (UTC)\n` +
        table(
          [
            "TIME",
            "APP",
            "ENV",
            "SHA",
            "KIND",
            "STATE",
            "IDENTIFIER",
            "SOURCE",
          ],
          selected.map((e) => [
            when(e.time),
            e.app || "repo/unknown",
            e.environment || "-",
            short(e.sha),
            e.kind,
            e.state,
            e.name || e.id,
            e.source,
          ]),
        ),
    );
    sections.push(
      ...selected
        .filter((e) => e.url)
        .map((e) => `  ${clean(e.id)}: ${clean(e.url)}`),
    );
  }
  sections.push(
    "\nFull SHAs, status timestamps, relationships and caveats: --json. Artifact links by SHA/app do not prove reuse.",
  );
  return sections.join("\n\n");
}
export function candidateTable(rows: Candidate[]): string {
  const summary = table(
    [
      "FULL COMMIT SHA",
      "WORKFLOW GATES",
      "STAGING TAG (UTC)",
      "PRODUCTION TAG (UTC)",
    ],
    rows.map((r) => [
      r.sha,
      r.classification,
      when([...r.staging].sort().at(-1)),
      when([...r.production].sort().at(-1)),
    ]),
  );
  const details = rows.map((row) => {
    const lines = [`${row.sha}: ${row.reasons.join("; ")}`];
    for (const [app, artifacts] of Object.entries(row.artifacts))
      lines.push(
        `  ${app}: ` +
          (artifacts
            .map(
              (a) =>
                `${a.name} (${a.state}, uploaded ${when(a.uploaded_at)} UTC)`,
            )
            .join(", ") ||
            "no same-checkout upload observed; reuse/build unresolved"),
      );
    if (row.release_tags.length)
      lines.push(`  Source release tags: ${row.release_tags.join(", ")}`);
    if (row.gate_url) lines.push(`  CI evidence: ${row.gate_url}`);
    return lines.join("\n");
  });
  return (
    summary +
    "\n\n" +
    details.join("\n\n") +
    "\n\nGates-pass means a verified staging tag + current successful ci/gate-passed status ONLY.\nNot approval, safety, artifact provenance, all-app staging, or a serving-state guarantee.\nProduction resolves by input hash and can build on a miss; landing is environment-specific.\nThis command does not deploy anything. Use the existing cd-production.yml workflow after review."
  );
}
