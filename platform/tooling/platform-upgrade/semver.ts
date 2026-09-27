/** Deliberately bounded semver support. Unknown syntax is an error, never "unaffected". */
export type Version = [number, number, number];
export function version(text: string): Version {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(text)) throw new Error("Unsupported version: " + text);
  const parts = text.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error("Version is too large: " + text);
  return parts as Version;
}
export function compare(a: string, b: string): number {
  const av = version(a), bv = version(b);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
  return 0;
}
export function satisfies(value: string, range: string): boolean {
  version(value);
  if (!range.trim()) throw new Error("Empty version range");
  // Validate every arm, including ones that do not determine the result.
  const alternatives = range.split("||").map(arm => {
    if (!arm.trim()) throw new Error("Empty alternative in range: " + range);
    return arm.trim().split(/\s+/).map(term => {
      if (term === "*") return true;
      const match = /^(\^|~|>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(term);
      if (!match) throw new Error("Unsupported version range: " + range);
      const op = match[1] ?? "=", bound = match[2], cmp = compare(value, bound);
      if (op === ">=") return cmp >= 0;
      if (op === "<=") return cmp <= 0;
      if (op === ">") return cmp > 0;
      if (op === "<") return cmp < 0;
      if (op === "=") return cmp === 0;
      const [major, minor, patch] = version(bound);
      const upper = op === "~" ? `${major}.${minor + 1}.0` : major > 0 ? `${major + 1}.0.0` : minor > 0 ? `0.${minor + 1}.0` : `0.0.${patch + 1}`;
      return cmp >= 0 && compare(value, upper) < 0;
    }).every(Boolean);
  });
  return alternatives.some(Boolean);
}
/** Floors can raise simple same-major ranges; uncertain/incompatible ranges require review. */
export function raiseFloor(range: string, minimum: string): { value?: string; reason?: string } {
  const floor = version(minimum);
  const match = /^(\^|~|=)?(\d+\.\d+\.\d+)$/.exec(range);
  if (!match) return { reason: "The app range is not a supported exact, caret or tilde range: " + range };
  const declared = version(match[2]);
  if (declared[0] !== floor[0]) return { reason: "The app and required floor use different major versions" };
  if (compare(match[2], minimum) >= 0) return { value: range };
  return { value: (match[1] ?? "") + minimum };
}
