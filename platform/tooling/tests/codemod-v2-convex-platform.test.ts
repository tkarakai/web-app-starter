import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inPlatformZone, main, migrate, movedSpecifier, parseArguments, rewriteText } from "../codemods/v2-convex-platform.ts";

// Fixtures spell `api.` and `internal.` in two halves so a repository-wide search for
// leftover pre-v2 function references finds only real ones.
const API = "api" + ".";
const INTERNAL = "internal" + ".";
const RUN = "convex" + " run";
const CONVEX = "packages/backend/convex";

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codemod-v2-convex-"));
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
    "apps/web/src/profile.tsx": [
      `const profile = useQuery(${API}userProfiles.get);`,
      `const user = await fetchAuthQuery(${API}auth.getCurrentUser, {});`,
      `const projects = useQuery(${API}projects.list);`,
      `const session = await auth.${API}getSession({ headers });`,
      `const invoices = useQuery(${API}invoices.list);`,
    ].join("\n"),
    [`${CONVEX}/invoices.ts`]: [
      `import { authedQuery } from "./functions";`,
      `import { scheduleAuditEvent } from "./auditTrailHelpers.ts";`,
      `import { internal } from "./_generated/api";`,
      `import { helper } from "./invoiceHelpers";`,
      `await ctx.scheduler.runAfter(0, ${INTERNAL}auditTrail.insert, {});`,
    ].join("\n"),
    [`${CONVEX}/billing/charge.ts`]: `import { authedMutation } from "../functions";\nconst mod = await import("../rateLimits");\n`,
    [`${CONVEX}/convex.config.ts`]: `import betterAuth from "./betterAuth/convex.config";\n`,
    [`${CONVEX}/platform/auth.ts`]: `import { rateLimit } from "./rateLimits";\nconst x = ${INTERNAL}auditTrail.insert;\n`,
    "scripts/seed.sh": `bunx ${RUN} devSeed:seed\nbunx ${RUN} --prod bootstrap:status '{}'\nbunx ${RUN} migrations\n`,
    "platform/docs/guide.md": `Call ${API}userProfiles.get.\n`,
  });
}

test("rewrites function references to moved modules only", () => {
  const { text, count } = rewriteText(
    `${API}userProfiles.get ${INTERNAL}auditTrail.insert ${API}projects.list ${API}authors.list auth.${API}signUpEmail components.betterAuth ${API}platform.auth.x`,
    "apps/web/src/a.ts",
  );
  assert.equal(text, `${API}platform.userProfiles.get ${INTERNAL}platform.auditTrail.insert ${API}projects.list ${API}authors.list auth.${API}signUpEmail components.betterAuth ${API}platform.auth.x`);
  assert.equal(count, 2);
});

test("rewrites convex run paths for moved modules", () => {
  const { text } = rewriteText(`bunx ${RUN} devSeed:seed\nnpx ${RUN} --prod bootstrap:status\nnpx ${RUN} migrations\n`, "x.sh");
  assert.equal(text, `bunx ${RUN} platform/devSeed:seed\nnpx ${RUN} --prod platform/bootstrap:status\nnpx ${RUN} migrations\n`);
});

test("resolves relative imports against the Convex directory", () => {
  assert.equal(movedSpecifier("./functions", CONVEX, CONVEX), "./platform/functions");
  assert.equal(movedSpecifier("./auth.ts", CONVEX, CONVEX), "./platform/auth.ts");
  assert.equal(movedSpecifier("../functions", `${CONVEX}/billing`, CONVEX), "../platform/functions");
  assert.equal(movedSpecifier("./betterAuth/schema", CONVEX, CONVEX), "./platform/betterAuth/schema");
  assert.equal(movedSpecifier("./projects", CONVEX, CONVEX), undefined);
  assert.equal(movedSpecifier("./_generated/api", CONVEX, CONVEX), undefined);
  assert.equal(movedSpecifier("./rateLimits", `${CONVEX}/platform`, CONVEX), undefined);
  assert.equal(movedSpecifier("../functions", "apps/web/src", CONVEX), undefined);
});

test("migrates an app tree and leaves platform directories alone", () => {
  const root = appTree();
  const changes = migrate({ root, check: false, includePlatform: false, convexDir: CONVEX });
  assert.deepEqual(changes.map(change => change.file).sort(), [
    "apps/web/src/profile.tsx",
    `${CONVEX}/billing/charge.ts`,
    `${CONVEX}/convex.config.ts`,
    `${CONVEX}/invoices.ts`,
    "scripts/seed.sh",
  ]);
  assert.match(read(root, "apps/web/src/profile.tsx"), new RegExp(`${API.replace(".", "\\.")}platform\\.userProfiles\\.get`));
  assert.match(read(root, "apps/web/src/profile.tsx"), new RegExp(`${API.replace(".", "\\.")}invoices\\.list`));
  assert.match(read(root, `${CONVEX}/invoices.ts`), /from "\.\/platform\/functions"/);
  assert.match(read(root, `${CONVEX}/invoices.ts`), /from "\.\/platform\/auditTrailHelpers\.ts"/);
  assert.match(read(root, `${CONVEX}/invoices.ts`), /from "\.\/invoiceHelpers"/);
  assert.match(read(root, `${CONVEX}/invoices.ts`), /from "\.\/_generated\/api"/);
  assert.equal(read(root, `${CONVEX}/billing/charge.ts`), `import { authedMutation } from "../platform/functions";\nconst mod = await import("../platform/rateLimits");\n`);
  assert.equal(read(root, `${CONVEX}/convex.config.ts`), `import betterAuth from "./platform/betterAuth/convex.config";\n`);
  assert.match(read(root, `${CONVEX}/platform/auth.ts`), /from "\.\/rateLimits"/);
  assert.equal(read(root, "platform/docs/guide.md"), `Call ${API}userProfiles.get.\n`);
});

test("is idempotent", () => {
  const root = appTree();
  migrate({ root, check: false, includePlatform: true, convexDir: CONVEX });
  assert.deepEqual(migrate({ root, check: false, includePlatform: true, convexDir: CONVEX }), []);
});

test("--include-platform rewrites references inside platform directories", () => {
  const root = appTree();
  migrate({ root, check: false, includePlatform: true, convexDir: CONVEX });
  assert.equal(read(root, `${CONVEX}/platform/auth.ts`), `import { rateLimit } from "./rateLimits";\nconst x = ${INTERNAL}platform.auditTrail.insert;\n`);
});

test("--check writes nothing and exits 1 when there is work", () => {
  const root = appTree();
  const before = read(root, "apps/web/src/profile.tsx");
  const lines: string[] = [];
  assert.equal(main(["--check", root], line => lines.push(line)), 1);
  assert.equal(read(root, "apps/web/src/profile.tsx"), before);
  assert.match(lines.at(-1) ?? "", /would rewrite \d+ reference\(s\) in 5 file\(s\)/);
  assert.equal(main([root], () => {}), 0);
  assert.equal(main(["--check", root], () => {}), 0);
});

test("parses arguments", () => {
  const options = parseArguments(["--convex-dir", "backend/convex/", "repo"]);
  assert.ok(typeof options !== "string");
  assert.equal(options.convexDir, "backend/convex");
  assert.equal(options.root, path.resolve("repo"));
  assert.match(String(parseArguments(["--convex-dir"])), /needs a directory/);
  assert.match(String(parseArguments(["--nope"])), /unexpected argument/);
  assert.equal(main(["/nonexistent-root-for-codemod"], () => {}), 2);
});

test("platform zone is any directory named platform", () => {
  assert.equal(inPlatformZone("platform/docs/a.md"), true);
  assert.equal(inPlatformZone(`${CONVEX}/platform/auth.ts`), true);
  assert.equal(inPlatformZone("apps/web/src/platform.ts"), false);
});
