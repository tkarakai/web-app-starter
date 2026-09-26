/**
 * How platform and app messages combine. Pure functions with no imports, so the
 * `check:i18n` tool (Node) and the runtime loader share them.
 *
 * - Each top-level namespace has one owner: the platform's files or the app's
 *   (`packages/messages/<locale>.json`). They are merged side by side.
 * - App overrides (`packages/messages/overrides.json`) are deep-merged over the
 *   platform's namespaces, one string at a time.
 */

/** A message tree: nested namespaces with string leaves. */
export type Messages = { [key: string]: string | Messages };

function isTree(value: unknown): value is Messages {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge `patch` over `base`: leaves in `patch` win; neither input is changed. */
export function deepMerge(base: Messages, patch: Messages): Messages {
  const result: Messages = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    result[key] = isTree(current) && isTree(value) ? deepMerge(current, value) : value;
  }
  return result;
}

/**
 * The messages an app loads for one locale: platform and app namespaces side by side,
 * with the app's overrides deep-merged over the platform's. An app namespace never
 * replaces a platform one (see {@link namespaceClashes}); if one is present anyway,
 * the platform's wins so platform UI keeps its strings.
 */
export function mergeMessages(platform: Messages, app: Messages, overrides: Messages = {}): Messages {
  // Overrides apply to platform namespaces only; an app edits its own files directly.
  const platformOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([namespace]) => Object.hasOwn(platform, namespace)),
  );
  return { ...app, ...deepMerge(platform, platformOverrides) };
}

/** Top-level namespaces defined by both the platform and the app. */
export function namespaceClashes(platform: Messages, app: Messages): string[] {
  return Object.keys(app).filter((namespace) => Object.hasOwn(platform, namespace));
}

/** Dotted paths of every string leaf in a tree. */
export function leafPaths(tree: Messages, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isTree(value) ? leafPaths(value, path) : [path];
  });
}

/**
 * Override paths that don't match a platform string: the key was renamed or removed
 * (usually by an upgrade), or the override targets a subtree instead of a string.
 * Such overrides are silently ignored at runtime; the check makes them visible.
 */
export function staleOverrides(platform: Messages, overrides: Messages): string[] {
  const platformLeaves = new Set(leafPaths(platform));
  return leafPaths(overrides).filter((path) => !platformLeaves.has(path));
}
