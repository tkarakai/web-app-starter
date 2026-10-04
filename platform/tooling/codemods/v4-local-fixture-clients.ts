#!/usr/bin/env node
/**
 * v4 local fixture endpoints require a generated capability and reject hosted targets.
 * Migrate the reference web E2E client without replacing application-owned tests.
 * Run from the app root: node platform/tooling/codemods/v4-local-fixture-clients.ts [--check] [ROOT].
 * Idempotent; --check writes nothing and exits 1 for pending changes. Custom client
 * layouts need the explicit edits in platform/docs/upgrading-v4.md before rerunning.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export function transform(source: string): string {
  if (!source.includes("/api/dev/e2e-user")) return source;
  const replacements: [string, string][] = [
    ['  for (const envPath of [\n    path.join(__dirname, "../../../.env.local"),', '  for (const envPath of [\n    process.env.DEV_FIXTURE_SECRET_FILE ?? path.join(__dirname, "../../../../../.env.e2e.local"),\n    path.join(__dirname, "../../../.env.local"),'],
    ['  return url.replace(/\\/$/, "");', `  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" ||
      !(["localhost", "127.0.0.1", "[::1]", "convex.localhost.floci.io"].includes(parsed.hostname) || parsed.hostname.endsWith(".localhost"))) {
    throw new Error("Fixture helpers only send their capability to a local backend.");
  }
  return parsed.origin;`],
    ['  const response = await fetch(`${convexSiteUrl()}/api/dev/e2e-user`, {', `  const secret = getEnvValue("DEV_FIXTURE_SECRET");
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw new Error("Local fixture secret is missing. Restart bun run dev, or set DEV_FIXTURE_SECRET_FILE to the local AWS fixture.env file.");

  const response = await fetch(\u0060\u0024{convexSiteUrl()}/api/dev/e2e-user\u0060, {`],
    ['    headers: { "Content-Type": "application/json" },', '    headers: { "Content-Type": "application/json", "X-Dev-Fixture-Secret": secret },\n    redirect: "error",'],
  ];
  let result = source;
  for (const [before, after] of replacements) {
    if (result.includes(after)) continue;
    if (result.split(before).length !== 2) throw Error("Custom fixture client requires review: follow platform/docs/upgrading-v4.md; no files changed.");
    result = result.replace(before, after);
  }
  return result;
}
export function migrate(root: string, check = false): string[] {
  const relative = "apps/web/qa/e2e/helpers/fixtures.ts", file = path.join(root, relative);
  if (!fs.existsSync(file)) return [];
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep)) throw Error("Fixture client escapes the app root");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error("Fixture client must be a regular file");
  const source = fs.readFileSync(file, "utf8"), content = transform(source);
  if (content === source) return [];
  if (!check) fs.writeFileSync(file, content, { mode: stat.mode });
  return [relative];
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v4-local-fixture-clients.ts [--check] [ROOT]");
    const files = migrate(path.resolve(values[0] ?? "."), check);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need migration" : "updated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
