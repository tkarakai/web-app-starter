/** Shared with the zone check: this is the shipped ownership boundary. */
export function isZonePath(file: string): boolean {
  const segments = file.split("/");
  return segments.some((segment, index) =>
    (segment === "platform" && index < segments.length - 1) || segment.startsWith("platform-"));
}
export function inScope(file: string, scope: string): boolean { return scope.endsWith("/") ? file.startsWith(scope) : file === scope; }
export function secretValueFile(file: string): boolean {
  return file.split("/").some(part => /^\.env(?:\.|$)/.test(part) && !/\.(?:example|template)$/.test(part)) || /(?:^|\/)(?:credentials|secrets)\.(?:json|ya?ml)$/.test(file);
}
