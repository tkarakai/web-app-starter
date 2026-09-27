import { isZonePath, secretValueFile } from "./ownership.ts";
export type EnvReference = { file: string; line: number; name: string; kind: "read" | "declaration" };
export type DynamicEnv = { file: string; line: number; kind: "dynamic-env-access" };
export type EnvScan = { references: EnvReference[]; dynamic: DynamicEnv[] };
export function scanEnvironment(files: Iterable<{ path: string; content: Buffer }>): EnvScan {
  const references: EnvReference[] = [], dynamic: DynamicEnv[] = [];
  for (const file of files) {
    if (isZonePath(file.path) || secretValueFile(file.path) || /(?:^|\/)(?:node_modules|_generated|\.next|dist|coverage|vendor)\//.test(file.path)) continue;
    if (!/\.(?:[cm]?[jt]sx?|sh|bash|zsh|ya?ml|json|example|template)$/.test(file.path)) continue;
    if (file.content.includes(0)) continue;
    const lines = file.content.toString("utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const add = (name: string, kind: EnvReference["kind"] = "read") => {
        if (!references.some(row => row.file === file.path && row.line === index + 1 && row.name === name && row.kind === kind)) references.push({ file: file.path, line: index + 1, name, kind });
      };
      const access = /(?:process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env)/g;
      for (const match of line.matchAll(access)) {
        const suffix = line.slice((match.index ?? 0) + match[0].length);
        const literal = /^\s*(?:\.\s*([A-Z_][A-Z0-9_]*)|\[\s*["']([A-Z_][A-Z0-9_]*)["']\s*\])/.exec(suffix);
        if (literal) add(literal[1] ?? literal[2]);
        else if (!dynamic.some(row => row.file === file.path && row.line === index + 1)) dynamic.push({ file: file.path, line: index + 1, kind: "dynamic-env-access" });
      }
      for (const match of line.matchAll(/\b(?:env|secrets|vars)\.([A-Z_][A-Z0-9_]*)/g)) add(match[1]);
      for (const match of line.matchAll(/\$(?:\{)?([A-Z_][A-Z0-9_]*)/g)) add(match[1]);
      const declaration = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
      if (declaration) add(declaration[1], "declaration");
    }
  }
  return { references, dynamic };
}
