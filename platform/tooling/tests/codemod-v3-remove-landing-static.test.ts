import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { migrate, removeJob, removePort } from "../codemods/v3-remove-landing-static.ts";

const VERIFY = `jobs:
  landing:
    needs: resolve
    uses: ./.github/workflows/platform-ci-landing.yml

  landing-static:
    needs: resolve
    uses: ./.github/workflows/platform-ci-landing-static.yml
    with:
      require_e2e: true

  verified:
    needs: [resolve, web, landing, landing-static, storybook]
`;

function write(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

function fixture(t: { after: (fn: () => void) => void }, landing = true): string {
  const root = mkdtempSync(path.join(tmpdir(), "codemod-landing-static-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "apps/landing-static/package.json", "{}");
  write(root, "apps/landing-static/src/app/page.tsx", "export default function Page() {}\n");
  if (landing) write(root, "apps/landing/package.json", "{}");
  write(root, ".github/workflows/ci-landing-static.yml", "jobs: {}\n");
  write(root, ".github/workflows/ci-verify.yml", VERIFY);
  write(root, "app.config.ts", 'const c = {\n  ports: {\n    landing: 3000,\n    "landing-static": 3004, // static\n  },\n};\n');
  write(root, "package.json", JSON.stringify({ scripts: { "dev:landing": "x", "dev:landing-static": "y" } }, null, 2) + "\n");
  write(root, "turbo.json", JSON.stringify({ tasks: { "@repo/landing#build": {}, "@repo/landing-static#build": {} } }, null, 2) + "\n");
  write(root, "tsconfig.json", '{\n  "references": [\n    { "path": "apps/landing" },\n    { "path": "apps/landing-static" }\n  ]\n}\n');
  return root;
}

test("removeJob drops the job block and its needs entries only", () => {
  const out = removeJob(VERIFY, "landing-static");
  assert.doesNotMatch(out, /landing-static/);
  assert.match(out, /^ {2}landing:$/m);
  assert.match(out, /needs: \[resolve, web, landing, storybook\]/);
});

test("removePort removes only the landing-static port", () => {
  assert.equal(removePort('    landing: 3000,\n    "landing-static": 3004,\n    web: 3001,\n'), "    landing: 3000,\n    web: 3001,\n");
});

test("migrate removes every landing-static remnant and is idempotent", t => {
  const root = fixture(t);
  assert.equal(migrate(root, true).length, 7);
  assert(existsSync(path.join(root, "apps/landing-static")), "--check writes nothing");
  assert.equal(migrate(root).length, 7);
  for (const file of ["apps/landing-static", ".github/workflows/ci-landing-static.yml"]) assert(!existsSync(path.join(root, file)));
  for (const file of ["app.config.ts", "package.json", "turbo.json", "tsconfig.json", ".github/workflows/ci-verify.yml"]) {
    assert.doesNotMatch(readFileSync(path.join(root, file), "utf8"), /landing-static/, file);
  }
  JSON.parse(readFileSync(path.join(root, "tsconfig.json"), "utf8"));
  assert.deepEqual(migrate(root, true), []);
});

test("migrate refuses to run before apps/landing exists", t => {
  const root = fixture(t, false);
  assert.throws(() => migrate(root), /apps\/landing is missing/);
  assert(existsSync(path.join(root, "apps/landing-static/src/app/page.tsx")));
});
