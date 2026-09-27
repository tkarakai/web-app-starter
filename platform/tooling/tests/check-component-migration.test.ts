import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMigration, parseRead } from "../check-component-migration.ts";
test("fresh deployments require successful empty probes of every legacy table", () => {
  let tables = 0;
  assert.equal(checkMigration(args => { if (args[0] === "run") throw new Error("No endpoint"); tables++; return []; }), "fresh");
  assert.equal(tables, 7);
});
test("legacy rows, in-progress migration and unreadable tables block deployment", () => {
  assert.throws(() => checkMigration(args => args[0] === "run" ? { phase: "not-started" } : [{}]), /additive bridge/);
  assert.throws(() => checkMigration(() => ({ phase: "copying" })), /still copying/);
  assert.throws(() => checkMigration(() => { throw new Error("Access denied"); }), /Access denied/);
  assert.throws(() => checkMigration(() => null), /Cannot establish/);
});
test("a completed receipt permits later deployments without comparing live app data", () => {
  assert.equal(checkMigration(args => { assert.equal(args[0], "run"); return { phase: "complete" }; }), "complete");
});

test("accepts the CLI empty-table notice without treating silent connection failures as empty", () => {
  assert.deepEqual(parseRead("", "Warning\nThere are no documents in this table.\n", "data"), []);
  assert.throws(() => parseRead("", "Local backend is not running", "data"), /unexpected response/);
  assert.throws(() => parseRead("", "There are no documents in this table.", "run"), /unexpected response/);
});
