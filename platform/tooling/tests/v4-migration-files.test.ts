import assert from "node:assert/strict";
import fs from "node:fs";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { migrate as migrateClient } from "../codemods/v4-local-fixture-clients.ts";
import { migrate as migrateApi } from "../codemods/v4-platform-api.ts";

for (const [name, migrate, relative] of [
  ["fixture client", migrateClient, "apps/web/qa/e2e/helpers/fixtures.ts"],
  ["generated API", migrateApi, "packages/backend/convex/_generated/api.d.ts"],
] as const) {
  const unchanged = migrate === migrateApi
    ? "/* THIS CODE IS AUTOMATICALLY GENERATED. */\ndeclare const fullApi: ApiFromModules<{\n}>;\n"
    : "// App helper without legacy fixture endpoints.\n";
  test(`${name}: contained parent links and a symlinked root preserve unchanged files`, t => {
    const base = fs.mkdtempSync(path.resolve("platform/tooling/tests/.v4-links-"));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const root = path.join(base, "app"), file = path.join(root, relative);
    const storage = path.join(root, "storage"), alias = path.join(base, "app-link");
    fs.mkdirSync(storage, { recursive: true });
    fs.mkdirSync(path.dirname(path.dirname(file)), { recursive: true });
    fs.symlinkSync(storage, path.dirname(file), "dir");
    fs.symlinkSync(root, alias, "dir");
    fs.writeFileSync(file, unchanged);
    for (const check of [false, true]) {
      assert.deepEqual(migrate(alias, check), []);
      assert.equal(fs.readFileSync(file, "utf8"), unchanged);
    }
  });
  for (const check of [false, true]) {
    test(`${name}: missing files and escaping links (${check ? "check" : "write"})`, t => {
      const base = fs.mkdtempSync(path.resolve("platform/tooling/tests/.v4-files-"));
      t.after(() => fs.rmSync(base, { recursive: true, force: true }));
      const root = path.join(base, "app"), file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (migrate === migrateClient) assert.deepEqual(migrate(root, check), []);
      else assert.throws(() => migrate(root, check), /Regenerate the custom Convex API/);

      const outside = path.join(base, "outside");
      fs.mkdirSync(outside);
      const target = path.join(outside, path.basename(file)), bytes = "outside bytes must stay unchanged";
      fs.writeFileSync(target, bytes);
      fs.symlinkSync(target, file);
      assert.throws(() => migrate(root, check));
      assert.equal(fs.readFileSync(target, "utf8"), bytes);
      fs.unlinkSync(file);

      fs.rmdirSync(path.dirname(file));
      fs.symlinkSync(outside, path.dirname(file), "dir");
      assert.throws(() => migrate(root, check), /inside the app root/);
      assert.equal(fs.readFileSync(target, "utf8"), bytes);
      fs.unlinkSync(path.dirname(file));
      fs.mkdirSync(file, { recursive: true });
      assert.throws(() => migrate(root, check));
    });

    test(`${name}: refuses a target replaced after opening (${check ? "check" : "write"})`, t => {
      const root = fs.mkdtempSync(path.resolve("platform/tooling/tests/.v4-race-"));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const file = path.join(root, relative), original = file + ".original";
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, unchanged);
      const open = fs.openSync;
      let replaced = false;
      t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
        const fd = open(...args);
        if (args[0] === file && !replaced) {
          replaced = true;
          fs.renameSync(file, original);
          fs.writeFileSync(file, "replacement bytes");
        }
        return fd;
      });
      syncBuiltinESMExports();
      try {
        assert.throws(() => migrate(root, check), /changed while opening/);
      } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      }
      assert.equal(fs.readFileSync(original, "utf8"), unchanged);
      assert.equal(fs.readFileSync(file, "utf8"), "replacement bytes");
    });
  }
}
