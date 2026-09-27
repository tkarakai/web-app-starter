import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrate } from "../codemods/v2-security-messages.ts";
function fixture(run: (root: string, write: (file: string, value: unknown) => void) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "security-messages-"));
  const write = (file: string, value: unknown) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(value)); };
  try { run(root, write); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test("custom wording becomes platform overrides, defaults and original app keys remain untouched", () => fixture((root, write) => {
  write("platform/packages/i18n/messages/en.json", { accountSecurity: { passkeys: { title: "Passkeys", add: "Add" } } });
  write("packages/messages/en.json", { dashboard: { passkeys: { title: "Your passkeys", add: "Add" } } });
  write("packages/messages/overrides.json", { en: { common: { save: "Keep" } } });
  const file = path.join(root, "packages/messages/overrides.json"), before = fs.readFileSync(file, "utf8");
  assert.deepEqual(migrate(root, true), ["packages/messages/overrides.json"]); assert.equal(fs.readFileSync(file, "utf8"), before);
  migrate(root); assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { en: { common: { save: "Keep" }, accountSecurity: { passkeys: { title: "Your passkeys" } } } });
  assert.deepEqual(migrate(root), []); assert.match(fs.readFileSync(path.join(root, "packages/messages/en.json"), "utf8"), /Your passkeys/);
}));
test("conflicting overrides and unknown customized keys stop before writing any locale", () => fixture((root, write) => {
  for (const locale of ["en", "fr"]) {
    write(`platform/packages/i18n/messages/${locale}.json`, { accountSecurity: { sessions: { title: "Sessions" } } });
    write(`packages/messages/${locale}.json`, { dashboard: { sessions: { title: "My sessions" } } });
  }
  write("packages/messages/overrides.json", { fr: { accountSecurity: { sessions: { title: "Existing override" } } } });
  const file = path.join(root, "packages/messages/overrides.json"), before = fs.readFileSync(file, "utf8");
  assert.throws(() => migrate(root), /Conflicting customized wording/); assert.equal(fs.readFileSync(file, "utf8"), before);
  write("packages/messages/fr.json", { dashboard: { sessions: { customKey: "Custom" } } });
  assert.throws(() => migrate(root), /No platform translation/); assert.equal(fs.readFileSync(file, "utf8"), before);
}));
test("prototype-related message keys are rejected without mutating shared objects or files", () => fixture((root, write) => {
  write("packages/messages/overrides.json", {});
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const malicious = JSON.parse(`{"${key}":{"polluted":"value"}}`);
    write("platform/packages/i18n/messages/en.json", { accountSecurity: { passkeys: malicious } });
    write("packages/messages/en.json", { dashboard: { passkeys: malicious } });
    assert.throws(() => migrate(root), /Unsafe message key/);
    assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
    assert.equal(fs.readFileSync(path.join(root, "packages/messages/overrides.json"), "utf8"), "{}");
  }
}));
