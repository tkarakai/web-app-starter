#!/usr/bin/env node
/**
 * Security settings moved to auth-ui and the platform accountSecurity namespace.
 * Preserve customized dashboard.{changePassword,twoFactor,passkeys,sessions} wording in
 * packages/messages/overrides.json. Original app keys remain for custom local components.
 * Run from the app root: node platform/tooling/codemods/v2-security-messages.ts [--check] [ROOT]
 * Idempotent; --check writes nothing. Conflicting overrides or unmappable custom keys stop
 * the whole operation before writing. Review those keys manually rather than losing wording.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
type Tree = { [key: string]: string | Tree };
const SECTIONS = ["changePassword", "twoFactor", "passkeys", "sessions"];
function object(value: unknown): value is Tree { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function read(file: string, optional = false): Tree {
  try { const value: unknown = JSON.parse(fs.readFileSync(file, "utf8")); if (!object(value)) throw new Error("Message file must be an object: " + file); return value; }
  catch (error) { if (optional && (error as { code?: string }).code === "ENOENT") return {}; throw error; }
}
function transfer(source: Tree, defaults: Tree, destination: Tree, label: string): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("Unsafe message key: " + label + "." + key);
    const target = defaults[key];
    if (typeof value === "string" && typeof target === "string") {
      if (value === target) continue;
      if (destination[key] !== undefined && destination[key] !== value) throw new Error("Conflicting customized wording: " + label + "." + key);
      if (destination[key] !== value) { destination[key] = value; changed = true; }
    } else if (object(value) && object(target)) {
      const existing = destination[key];
      if (existing !== undefined && !object(existing)) throw new Error("Conflicting override shape: " + label + "." + key);
      const nested = object(existing) ? existing : {};
      if (transfer(value, target, nested, label + "." + key)) { destination[key] = nested; changed = true; }
    } else throw new Error("No platform translation matches " + label + "." + key + "; review this custom key");
  }
  return changed;
}
export function migrate(root: string, check = false): string[] {
  const directory = path.join(root, "packages/messages"), output = path.join(directory, "overrides.json");
  const overrides = read(output, true); let changed = false;
  for (const locale of fs.readdirSync(path.join(root, "platform/packages/i18n/messages")).filter(file => /^[a-z]{2}\.json$/.test(file))) {
    const app = read(path.join(directory, locale), true), platform = read(path.join(root, "platform/packages/i18n/messages", locale));
    if (!object(app.dashboard)) continue;
    if (!object(platform.accountSecurity)) throw new Error("Install v2 accountSecurity messages first");
    const language = locale.slice(0, -5), current = overrides[language];
    if (current !== undefined && !object(current)) throw new Error("Invalid locale overrides: " + language);
    const languageOverrides = object(current) ? current : {}, existing = languageOverrides.accountSecurity;
    if (existing !== undefined && !object(existing)) throw new Error("Invalid accountSecurity overrides: " + language);
    const security = object(existing) ? existing : {}; let localeChanged = false;
    for (const section of SECTIONS) {
      if (app.dashboard[section] === undefined) continue;
      const source = { [section]: app.dashboard[section] };
      if (transfer(source, platform.accountSecurity, security, language + ".accountSecurity")) localeChanged = true;
    }
    if (localeChanged) { languageOverrides.accountSecurity = security; overrides[language] = languageOverrides; changed = true; }
  }
  if (changed && !check) fs.writeFileSync(output, JSON.stringify(overrides, null, 2) + "\n");
  return changed ? ["packages/messages/overrides.json"] : [];
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw new Error("Usage: v2-security-messages.ts [--check] [ROOT]");
    const files = migrate(path.resolve(values[0] ?? "."), check);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need migration" : "updated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
