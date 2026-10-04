#!/usr/bin/env node
/** v4 adds internal platform modules. Extend Convex's generated declaration contract
 * during the upgrade so source verification does not require deploying a backend first.
 * Only bindings for platform-owned modules are generated; app module bindings are preserved.
 * Run from the app root: node platform/tooling/codemods/v4-platform-api.ts [--check] [ROOT].
 * Idempotent, dependency-free, and --check never writes. Unknown generated formats fail closed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
const modules = ["authRateLimits", "localFixtures", "recoveryCodes"] as const;
export function migrate(root: string, check = false): string[] {
  const relative = "packages/backend/convex/_generated/api.d.ts", file = path.join(root, relative);
  if (!fs.existsSync(file)) throw Error("Regenerate the custom Convex API format for v4 before upgrading; see platform/docs/upgrading-v4.md");
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep)) throw Error("Generated API must be a regular file inside the app");
  const fd = fs.openSync(file, (check ? fs.constants.O_RDONLY : fs.constants.O_RDWR) | fs.constants.O_NOFOLLOW);
  try {
  if (!fs.fstatSync(fd).isFile()) throw Error("Generated API must be a regular file");
  const source = fs.readFileSync(fd, "utf8"); let content = source;
  const marker = "declare const fullApi: ApiFromModules<{\n";
  if (!source.includes("THIS CODE IS AUTOMATICALLY GENERATED.") || source.split(marker).length !== 2) throw Error("Unknown Convex API declaration format; regenerate for v4 before upgrading");
  for (const name of modules) {
    if (!fs.existsSync(path.join(root, "packages/backend/convex/platform", name + ".ts"))) continue;
    const alias = "platform_" + name;
    const declaration = `import type * as ${alias} from "../platform/${name}.js";\n`;
    const binding = `  "platform/${name}": typeof ${alias};\n`;
    const hasImport = content.includes(declaration), hasBinding = content.includes(binding);
    if (hasImport !== hasBinding) throw Error("Incomplete generated platform API binding: " + name);
    if (hasImport) continue;
    if (content.includes(alias)) throw Error("Conflicting generated platform API alias: " + alias);
    content = declaration + content;
    content = content.replace(marker, marker + binding);
  }
  if (content === source) return [];
  if (!check) { fs.writeSync(fd, content, 0, "utf8"); fs.ftruncateSync(fd, Buffer.byteLength(content)); }
  return [relative];
  } finally { fs.closeSync(fd); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v4-platform-api.ts [--check] [ROOT]");
    const files = migrate(path.resolve(values[0] ?? "."), check);
    for (const file of files) console.log((check ? "Would generate " : "Generated ") + file);
    console.log(files.length + " file(s) " + (check ? "need generation" : "generated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
