import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkMessages } from "../check-i18n.ts";
import { deepMerge, mergeMessages, namespaceClashes, staleOverrides } from "../../packages/i18n/src/merge.ts";

function tree(files: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-i18n-"));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(content));
  }
  return root;
}

const platformEn = { auth: { signIn: { title: "Sign in", cta: "Go" } }, common: { save: "Save" } };
const platformDe = { auth: { signIn: { title: "Anmelden", cta: "Los" } }, common: { save: "Speichern" } };
const appEn = { bookmarks: { title: "Bookmarks" } };
const appDe = { bookmarks: { title: "Lesezeichen" } };

function repo(overrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): string {
  return tree({
    "platform/packages/i18n/messages/en.json": platformEn,
    "platform/packages/i18n/messages/de.json": platformDe,
    "packages/messages/en.json": appEn,
    "packages/messages/de.json": appDe,
    "packages/messages/overrides.json": overrides,
    ...extra,
  });
}

test("merges platform and app namespaces, overrides over platform strings only", () => {
  const merged = mergeMessages(platformEn, { ...appEn, auth: { x: "shadow" } }, {
    auth: { signIn: { title: "Log in" } },
    bookmarks: { title: "ignored: not a platform namespace" },
  });
  assert.deepEqual(merged, {
    bookmarks: { title: "Bookmarks" },
    auth: { signIn: { title: "Log in", cta: "Go" } },
    common: { save: "Save" },
  });
  assert.deepEqual(deepMerge({ a: { b: "1", c: "2" } }, { a: { c: "3" } }), { a: { b: "1", c: "3" } });
  assert.deepEqual(namespaceClashes(platformEn, { auth: {}, bookmarks: {} }), ["auth"]);
  assert.deepEqual(staleOverrides(platformEn, { auth: { signIn: { title: "x", subtitle: "y" }, gone: "z" } }), ["auth.signIn.subtitle", "auth.gone"]);
});

test("a consistent tree passes", () => {
  assert.deepEqual(checkMessages(repo({ en: { auth: { signIn: { title: "Log in" } } } }), ["en", "de"]), []);
});

test("an app string needs only app files: a missing translation is named", () => {
  const root = repo({}, { "packages/messages/de.json": {} });
  assert.deepEqual(checkMessages(root, ["en", "de"]), ["packages/messages/de.json: missing bookmarks.title"]);
  assert.deepEqual(checkMessages(root, ["en"]), [], "an unshipped locale needs no app file");
});

test("flags stale overrides, overrides of unshipped locales, clashes and platform drift", () => {
  const root = repo(
    { en: { auth: { signIn: { heading: "Old key" } } }, fr: { common: { save: "Enregistrer" } } },
    {
      "packages/messages/en.json": { ...appEn, common: { extra: "x" } },
      "packages/messages/de.json": { ...appDe, common: { extra: "y" } },
      "platform/packages/i18n/messages/de.json": { auth: { signIn: { title: "Anmelden" } }, common: { save: "Speichern" } },
    },
  );
  assert.deepEqual(checkMessages(root, ["en", "de", "xx"]), [
    "platform/packages/i18n/messages/de.json: missing auth.signIn.cta",
    'packages/messages/en.json: namespace "common" is the platform\'s; use your own namespace name (or override its strings in overrides.json)',
    'app.config.ts i18n.locales: "xx" has no platform messages; supported: de, en',
    "packages/messages/xx.json: missing (the locale is in app.config.ts i18n.locales)",
    "packages/messages/overrides.json: en.auth.signIn.heading overrides no platform string (renamed or removed?)",
    'packages/messages/overrides.json: "fr" is not in app.config.ts i18n.locales',
  ]);
});
