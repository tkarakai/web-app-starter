import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { migrate } from "../codemods/v4-platform-api.ts";

test("generated platform bindings make real Convex API consumers typecheck while preserving app bindings", t => {
  const root = fs.mkdtempSync(path.resolve("packages/backend/.v4-api-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const convex = path.join(root, "packages/backend/convex"), generated = path.join(convex, "_generated/api.d.ts");
  fs.mkdirSync(path.dirname(generated), { recursive: true }); fs.mkdirSync(path.join(convex, "platform"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  const declaration = 'import { internalMutationGeneric } from "convex/server"; export const ping = internalMutationGeneric({args:{},handler:()=>null});';
  fs.writeFileSync(path.join(convex, "business.ts"), declaration);
  for (const name of ["authAssurance", "authRateLimits", "localFixtures", "recoveryCodes", "sessionAssurance", "sessionFields", "sessionPolicy"]) fs.writeFileSync(path.join(convex, "platform", name + ".ts"), declaration);
  const source = `/* THIS CODE IS AUTOMATICALLY GENERATED. */
import type * as business from "../business.js";
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
declare const fullApi: ApiFromModules<{
  business: typeof business;
}>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
`;
  fs.writeFileSync(generated, source);
  const consumer = path.join(convex, "consumer.ts");
  fs.writeFileSync(consumer, `import { internal } from "./_generated/api.js";
internal.business.ping;
internal.platform.authAssurance.ping;
internal.platform.sessionAssurance.ping;
internal.platform.sessionFields.ping;
internal.platform.sessionPolicy.ping;
internal.platform.authRateLimits.ping;
internal.platform.localFixtures.ping;
internal.platform.recoveryCodes.ping;
// @ts-expect-error A typed Convex reference is not a number.
const n: number = internal.platform.authRateLimits.ping;
`);
  const compile = () => spawnSync(path.resolve("node_modules/.bin/tsc"), ["--ignoreConfig", "--noEmit", "--skipLibCheck", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", consumer], { encoding: "utf8" });
  const before = compile(); assert.notEqual(before.status, 0); assert.match(before.stdout, /Property 'platform' does not exist/);
  assert.deepEqual(migrate(root, true), ["packages/backend/convex/_generated/api.d.ts"]); assert.equal(fs.readFileSync(generated, "utf8"), source);
  migrate(root); const result = compile(); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(migrate(root), []); assert.deepEqual(migrate(root, true), []);
  fs.writeFileSync(generated, "custom format"); assert.throws(() => migrate(root), /Unknown Convex API/); assert.equal(fs.readFileSync(generated, "utf8"), "custom format");
});
