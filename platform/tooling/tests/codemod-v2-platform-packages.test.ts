import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { main, migrate, parseArguments, rewriteText } from "../codemods/v2-platform-packages.ts";

// Fixtures spell the old scope in two halves so a repository-wide search for
// leftover `@repo/<platform package>` references finds only real ones.
const OLD = "@repo" + "/";

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codemod-v2-"));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), "utf8");

function appTree(): string {
  return tree({
    "package.json": `{ "workspaces": ["apps/*", "packages/*", "platform/packages/*"] }\n`,
    "apps/web/package.json": JSON.stringify({
      name: "@repo/web",
      dependencies: { [`${OLD}auth`]: "workspace:*", [`${OLD}design-system`]: "workspace:*", "@repo/backend": "workspace:*" },
    }, null, 2),
    "apps/web/src/page.tsx": [
      `import { Button } from "${OLD}design-system";`,
      `import { authClient } from "${OLD}auth/client";`,
      `import { api } from "@repo/backend";`,
      `import { AuthForm } from "${OLD}auth-ui";`,
      `const en = await import("${OLD}i18n/messages/en.json");`,
    ].join("\n"),
    "apps/web/src/app/globals.css": `@import "${OLD}design-system/styles/globals.css";\n`,
    "apps/web/next.config.ts": `transpilePackages: ["${OLD}app-config", "${OLD}edge-rate-limit", "@repo/backend"],\n`,
    "apps/web/tailwind.config.ts": `content: ["./src/**/*.tsx", "../../packages/design-system/src/**/*.{ts,tsx}"],\n`,
    "turbo.json": `{ "tasks": { "${OLD}starter-sidebar-policy#build": {} } }\n`,
    "docs/notes.md": "Messages live in `packages/i18n/messages/`; see packages/ops. Our own code is in packages/backend and my-packages/auth.\n",
    "apps/web/node_modules/x/index.js": `require("${OLD}auth");\n`,
    "apps/web/.next/server.js": `require("${OLD}auth");\n`,
    "bun.lock": `"${OLD}auth": ["${OLD}auth@workspace:packages/auth"],\n`,
    "platform/apps/admin/tailwind.config.ts": `content: ["../../packages/design-system/src/**/*.{ts,tsx}"]; import "${OLD}auth";\n`,
  });
}

test("rewrites platform package specifiers and leaves app packages alone", () => {
  const { text, count } = rewriteText(
    `import "${OLD}auth/client"; import "${OLD}auth-ui"; import "@repo/backend"; import "${OLD}ops";`,
    { paths: false },
  );
  assert.equal(text, `import "@web-app-starter/auth/client"; import "${OLD}auth-ui"; import "@repo/backend"; import "@web-app-starter/ops";`);
  assert.equal(count, 2);
});

test("rewrites paths to moved packages but not ones already under platform/", () => {
  const { text } = rewriteText(
    "a ../../packages/design-system/src b packages/i18n. c platform/packages/auth d packages/backend e my-packages/auth f './packages/app-config/src/schema.ts'",
    { paths: true },
  );
  assert.equal(
    text,
    "a ../../platform/packages/design-system/src b platform/packages/i18n. c platform/packages/auth d packages/backend e my-packages/auth f './platform/packages/app-config/src/schema.ts'",
  );
});

test("migrates an app tree and is idempotent", () => {
  const root = appTree();
  const first = migrate({ root, check: false, includePlatform: false });
  assert.ok(first.length > 0);

  const page = read(root, "apps/web/src/page.tsx");
  assert.match(page, /from "@web-app-starter\/design-system"/);
  assert.match(page, /from "@web-app-starter\/auth\/client"/);
  assert.match(page, /from "@repo\/backend"/);
  assert.ok(page.includes(`${OLD}auth-ui`), "a non-platform package with a similar name is untouched");
  assert.match(page, /import\("@web-app-starter\/i18n\/messages\/en.json"\)/);

  const pkg = JSON.parse(read(root, "apps/web/package.json")) as { dependencies: Record<string, string> };
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@repo/backend", "@web-app-starter/auth", "@web-app-starter/design-system"]);
  assert.equal(read(root, "apps/web/src/app/globals.css"), `@import "@web-app-starter/design-system/styles/globals.css";\n`);
  assert.match(read(root, "apps/web/next.config.ts"), /"@web-app-starter\/app-config", "@web-app-starter\/edge-rate-limit", "@repo\/backend"/);
  assert.match(read(root, "apps/web/tailwind.config.ts"), /"\.\.\/\.\.\/platform\/packages\/design-system\/src/);
  assert.match(read(root, "turbo.json"), /"@web-app-starter\/starter-sidebar-policy#build"/);
  assert.equal(
    read(root, "docs/notes.md"),
    "Messages live in `platform/packages/i18n/messages/`; see platform/packages/ops. Our own code is in packages/backend and my-packages/auth.\n",
  );

  // Generated files, lockfiles and the platform zone are not touched.
  assert.equal(read(root, "apps/web/node_modules/x/index.js"), `require("${OLD}auth");\n`);
  assert.equal(read(root, "apps/web/.next/server.js"), `require("${OLD}auth");\n`);
  assert.ok(read(root, "bun.lock").includes(`${OLD}auth`));
  assert.ok(read(root, "platform/apps/admin/tailwind.config.ts").includes(`${OLD}auth`));

  const snapshot = fs.readdirSync(root, { recursive: true, encoding: "utf8" }).map(f => [f, fs.statSync(path.join(root, f)).isFile() ? read(root, f) : ""]);
  assert.deepEqual(migrate({ root, check: false, includePlatform: false }), [], "second run changes nothing");
  assert.deepEqual(fs.readdirSync(root, { recursive: true, encoding: "utf8" }).map(f => [f, fs.statSync(path.join(root, f)).isFile() ? read(root, f) : ""]), snapshot);
});

test("--include-platform renames specifiers inside platform/ without touching its paths", () => {
  const root = appTree();
  migrate({ root, check: false, includePlatform: true });
  assert.equal(
    read(root, "platform/apps/admin/tailwind.config.ts"),
    `content: ["../../packages/design-system/src/**/*.{ts,tsx}"]; import "@web-app-starter/auth";\n`,
  );
  assert.deepEqual(migrate({ root, check: false, includePlatform: true }), []);
});

test("--check reports, writes nothing and exits 1; exits 0 once migrated", () => {
  const root = appTree();
  const before = read(root, "apps/web/src/page.tsx");
  const lines: string[] = [];
  assert.equal(main(["--check", root], line => lines.push(line)), 1);
  assert.equal(read(root, "apps/web/src/page.tsx"), before);
  assert.ok(lines.some(line => line.startsWith("would rewrite") && line.endsWith("apps/web/src/page.tsx")));

  const applied: string[] = [];
  assert.equal(main([root], line => applied.push(line)), 0);
  assert.match(applied.at(-1) ?? "", /bun install/);
  assert.equal(main(["--check", root], () => undefined), 0);
});

test("argument handling", () => {
  assert.equal(typeof parseArguments(["--help"]), "string");
  assert.match(parseArguments(["--nope"]) as string, /unexpected argument/);
  assert.match(parseArguments(["a", "b"]) as string, /unexpected argument: b/);
  assert.deepEqual(parseArguments(["--check", "/tmp/x"]), { root: "/tmp/x", check: true, includePlatform: false });
  const lines: string[] = [];
  assert.equal(main([fs.mkdtempSync(path.join(os.tmpdir(), "codemod-v2-empty-"))], line => lines.push(line)), 2);
  assert.match(lines[0] ?? "", /no package\.json/);
});
