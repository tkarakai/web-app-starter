/** GitHub identity links require an exact parsed origin and repository route.
 * Display-only HTTPS sanitization is not sufficient to authorize evidence joins.
 */
export interface GitHubActionLink {
  url: string;
  kind: "run" | "job" | "artifact";
  runId: number;
  targetId: number | null;
}

export function githubActionLink(
  value: unknown,
  repo: string,
): GitHubActionLink | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.origin !== "https://github.com" ||
      parsed.username ||
      parsed.password
    )
      return null;
    const match =
      /^\/([^/]+)\/([^/]+)\/actions\/runs\/([1-9]\d*)(?:\/(job|artifacts)\/([1-9]\d*))?$/.exec(
        parsed.pathname,
      );
    if (!match || `${match[1]}/${match[2]}` !== repo) return null;
    const runId = Number(match[3]);
    const targetId = match[5] ? Number(match[5]) : null;
    if (
      !Number.isSafeInteger(runId) ||
      (targetId !== null && !Number.isSafeInteger(targetId))
    )
      return null;
    return {
      url: `${parsed.origin}${parsed.pathname}`,
      kind:
        match[4] === "job"
          ? "job"
          : match[4] === "artifacts"
            ? "artifact"
            : "run",
      runId,
      targetId,
    };
  } catch {
    return null;
  }
}

/** Read complete annotation lines, never a trusted-looking URL substring. */
export function annotationRunId(message: string, repo: string): number | null {
  const ids = new Set<number>();
  for (const line of message.split(/\r?\n/)) {
    if (!line.startsWith("Workflow run:")) continue;
    const match = /^Workflow run: (\S+)\s*$/.exec(line);
    if (!match) return null;
    const link = githubActionLink(match[1], repo);
    if (!link || link.kind !== "run") return null;
    ids.add(link.runId);
  }
  return ids.size === 1 ? [...ids][0] : null;
}
