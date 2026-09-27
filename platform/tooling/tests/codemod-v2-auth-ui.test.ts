import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appDirectory, main, migrate, parseArguments, rewriteText } from "../codemods/v2-auth-ui.ts";

// Fixtures build the old specifiers from parts so a repository-wide search for leftover
// pre-v2 imports finds only real ones.
const AT = "@" + "/";

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codemod-v2-auth-ui-"));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), "utf8");

function appTree(): string {
  return tree({
    "package.json": "{}\n",
    "apps/web/src/components/settings/profile.tsx": [
      `import { useAuthUser } from "${AT}components/auth/auth-guard";`,
      `import { LocaleSwitcher } from '${AT}components/ui/locale-switcher';`,
      `import { Button } from "${AT}components/ui/button";`,
    ].join("\n"),
    "apps/web/qa/tests/guard.test.tsx": `vi.mock("${AT}lib/auth-broadcast", () => ({}));\nimport { GuestGuard } from "${AT}components/auth/guest-guard";\n`,
    "apps/shop/src/components/auth/auth-form.tsx": "export function AuthForm() {}\n",
    "apps/shop/src/app/page.tsx": `import { AuthForm } from "${AT}components/auth/auth-form";\nimport { ForceSystemTheme } from "${AT}components/auth/force-system-theme";\n`,
    "platform/apps/admin/src/a.tsx": `import { broadcastAuth } from "${AT}lib/auth-broadcast";\n`,
  });
}

test("rewrites moved specifiers only", () => {
  const { text, count } = rewriteText(`import { A } from "${AT}components/auth/auth-guard";\nimport { B } from "${AT}components/auth/auth-guardian";\nimport { C } from "${AT}lib/auth-locale";`);
  assert.equal(text, `import { A } from "@web-app-starter/auth-ui";\nimport { B } from "${AT}components/auth/auth-guardian";\nimport { C } from "@web-app-starter/auth-ui";`);
  assert.equal(count, 2);
});

test("keeps imports of modules the app still has, and skips platform/", () => {
  const root = appTree();
  const changes = migrate({ root, check: false });
  assert.deepEqual(changes.map(change => change.file).sort(), [
    "apps/shop/src/app/page.tsx",
    "apps/web/qa/tests/guard.test.tsx",
    "apps/web/src/components/settings/profile.tsx",
  ]);
  assert.match(read(root, "apps/shop/src/app/page.tsx"), new RegExp(`from "${AT}components/auth/auth-form"`));
  assert.match(read(root, "apps/shop/src/app/page.tsx"), /ForceSystemTheme } from "@web-app-starter\/auth-ui"/);
  assert.match(read(root, "apps/web/qa/tests/guard.test.tsx"), /vi\.mock\("@web-app-starter\/auth-ui"/);
  assert.match(read(root, "apps/web/src/components/settings/profile.tsx"), /from '@web-app-starter\/auth-ui'/);
  assert.match(read(root, "apps/web/src/components/settings/profile.tsx"), new RegExp(`from "${AT}components/ui/button"`));
  assert.match(read(root, "platform/apps/admin/src/a.tsx"), new RegExp(`from "${AT}lib/auth-broadcast"`));
});

test("is idempotent, and --check reports without writing", () => {
  const root = appTree();
  const before = read(root, "apps/web/src/components/settings/profile.tsx");
  const lines: string[] = [];
  assert.equal(main(["--check", root], line => lines.push(line)), 1);
  assert.equal(read(root, "apps/web/src/components/settings/profile.tsx"), before);
  assert.match(lines.at(-1) ?? "", /would rewrite 5 import\(s\) in 3 file\(s\)/);
  assert.equal(main([root], () => {}), 0);
  assert.deepEqual(migrate({ root, check: false }), []);
});

test("finds the app directory and parses arguments", () => {
  assert.equal(appDirectory("apps/web/qa/tests/a.test.ts"), "apps/web");
  assert.equal(appDirectory("apps/web/src/lib/x.ts"), "apps/web");
  assert.equal(appDirectory("scripts/x.ts"), undefined);
  assert.match(String(parseArguments(["--nope"])), /unexpected argument/);
  assert.equal(main(["/nonexistent-root-for-codemod"], () => {}), 2);
});
