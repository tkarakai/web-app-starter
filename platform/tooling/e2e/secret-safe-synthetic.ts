/** No backend, real credentials, external pages or shared browser: generated marker acceptance only. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateReport, counts } from "./secret-safe-report.ts";

const root = mkdtempSync(join(tmpdir(), "secret-safe-browser-proof-"));
const require = createRequire(import.meta.url);
const testModule = require.resolve("@playwright/test");
const cli = join(dirname(require.resolve("@playwright/test/package.json")), "cli.js");
const wrapper = fileURLToPath(new URL("./secret-safe-playwright.ts", import.meta.url));
const reporter = fileURLToPath(new URL("./secret-safe-reporter.ts", import.meta.url));
const guard = fileURLToPath(new URL("./secret-safe-config.ts", import.meta.url));
const markers = ["password", "totp", "recovery", "urltoken", "header", "body"].map(kind => ["GENERATED", kind, "MARKER", "9e371d"].join("_"));
const spec = `const {test,expect}=require(${JSON.stringify(testModule)});
const markers=['password','totp','recovery','urltoken','header','body'].map(kind=>['GENERATED',kind,'MARKER','9e371d'].join('_'));
console.log('loader output '+markers.join(' '));
test('passing '+markers[0],async({page},info)=>{
 await page.route('http://synthetic.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<input aria-label="Password" type="password"><input aria-label="Code"><main>'+markers[2]+'</main>'}));
 await page.goto('http://synthetic.invalid/accept?token='+markers[3]+'#'+markers[4]);
 await page.getByLabel('Password').fill(markers[0]); await page.getByLabel('Code').pressSequentially(markers[1]);
 console.log(markers.join(' ')); console.error(markers.join(' '));
 info.annotations.push({type:markers[4],description:markers[5]});
 await info.attach(markers[2],{body:Buffer.from(markers.join(' ')),contentType:'text/plain'});
 await expect(page.getByLabel('Password')).toHaveValue(markers[0]);
});
test('failing '+markers[1],async({page},info)=>{
 await page.setContent('<main>'+markers.join(' ')+'</main>');
 await info.attach('unsafe attachment',{body:Buffer.from(markers.join(' ')),contentType:'application/json'});
 expect({headers:{authorization:markers[4]},body:markers[5],recovery:markers[2]}).toEqual({headers:{authorization:'safe'},body:'safe',recovery:'safe'});
});`;
writeFileSync(join(root, "marker.spec.cjs"), spec);
const config = { testDir: root, testMatch: "marker.spec.cjs", outputDir: join(root, "baseline-results"), workers: 1, retries: 0,
  reporter: [["html", { outputFolder: join(root, "baseline-report"), open: "never" }], ["json", { outputFile: join(root, "baseline.json") }]],
  use: { trace: "off", screenshot: "off", video: "off" } };
writeFileSync(join(root, "baseline.config.cjs"), `module.exports=${JSON.stringify(config)};`);
writeFileSync(join(root, "safe.config.cjs"), `require(${JSON.stringify(guard)}).assertSecretSafeRunner();module.exports=${JSON.stringify(config)};`);
const environment: Record<string, string | undefined> = { ...process.env, PLAYWRIGHT_HTML_OPEN: "never" };
delete environment.PLAYWRIGHT_NO_COPY_PROMPT;
function run(name: string, program: string, argv: string[], env = environment) {
  const result = spawnSync(program, argv, { cwd: root, env, encoding: "utf8", timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(root, `${name}.log`), (result.stdout ?? "") + (result.stderr ?? ""));
  return result;
}
function contents(path: string): string {
  return readdirSync(path, { withFileTypes: true }).map(entry => entry.isDirectory() ? contents(join(path, entry.name)) : readFileSync(join(path, entry.name)).toString()).join("\n");
}
const baseline = run("baseline", process.execPath, [cli, "test", "--config", join(root, "baseline.config.cjs")]);
assert.equal(baseline.status, 1);
const baselineJson = readFileSync(join(root, "baseline.json"), "utf8");
assert.equal(JSON.parse(baselineJson).stats.expected, 1);
assert.equal(JSON.parse(baselineJson).stats.unexpected, 1);
for (const marker of markers) assert.ok(baselineJson.includes(marker), "Baseline must demonstrate the leak");
const zip = readFileSync(join(root, "baseline-report/index.html"), "utf8").match(/data:application\/zip;base64,([A-Za-z0-9+/=]+)/);
assert.ok(zip, "Pinned HTML must contain report ZIP");
const archive = join(root, "baseline-report.zip"); writeFileSync(archive, Buffer.from(zip[1], "base64"));
const decoded = spawnSync("unzip", ["-p", archive], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
assert.equal(decoded.status, 0); assert.ok(decoded.stdout.includes(markers[0]), "Passing HTML steps leak typed values");
const titles: string[] = [];
function stepTitles(value: unknown) {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.steps)) for (const step of record.steps) if (typeof step?.title === "string") titles.push(step.title);
  for (const item of Object.values(record)) if (Array.isArray(item)) item.forEach(stepTitles); else stepTitles(item);
}
const entries = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" }); assert.equal(entries.status, 0);
for (const entry of entries.stdout.trim().split("\n").filter(file => file.endsWith(".json"))) {
  const extracted = spawnSync("unzip", ["-p", archive, entry], { encoding: "utf8" }); assert.equal(extracted.status, 0);
  stepTitles(JSON.parse(extracted.stdout));
}
assert.ok(titles.some(title => title.startsWith("Fill ") && title.includes(markers[0])), "Leak must be in API step, not just test title");
assert.ok(titles.some(title => title.startsWith("Type ") && title.includes(markers[1])));
assert.ok(contents(join(root, "baseline-results")).includes(markers[2]), "Failure artifacts leak visible values");
const safeRuns = [];
for (const format of ["list", "github", "json", "html"]) {
  const reportDir = join(root, `safe-${format}`);
  const result = run(`safe-${format}`, process.execPath, [wrapper, "--config", join(root, "safe.config.cjs"), `--reporter=${format}`], { ...environment, E2E_SAFE_REPORT_DIR: reportDir });
  assert.equal(result.status, 1, "Deliberate failure must remain failing");
  const report = validateReport(JSON.parse(readFileSync(join(reportDir, "report.json"), "utf8")));
  assert.equal(report.status, "failed"); assert.equal(counts(report).passed, 1); assert.equal(counts(report).failed, 1);
  assert.ok(report.tests.some(test => test.attempts.some(attempt => attempt.diagnostics.includes("assertion"))));
  for (const marker of markers) assert.ok(![result.stdout, result.stderr, contents(reportDir)].join("\n").includes(marker), `No marker in ${format} output`);
  safeRuns.push({ format, exit: result.status, counts: counts(report), markersFound: 0 });
}
const passing = run("safe-passing", process.execPath, [wrapper, "--config", join(root, "safe.config.cjs"), "--grep", "passing ", "--reporter=list"], { ...environment, E2E_SAFE_REPORT_DIR: join(root, "safe-passing") });
assert.equal(passing.status, 0);
for (const marker of markers) assert.ok(![passing.stdout, passing.stderr, contents(join(root, "safe-passing"))].join("\n").includes(marker));
const bypass = run("direct-refused", process.execPath, [cli, "test", "--config", join(root, "safe.config.cjs"), "--reporter=list"]);
assert.equal(bypass.status, 1); assert.ok(!bypass.stdout.includes("loader output"));
const missing = run("missing-result", process.execPath, [wrapper, "--help"], { ...environment, E2E_SAFE_REPORT_DIR: join(root, "missing-result") });
assert.equal(missing.status, 1, "A zero child exit without a safe report must fail");
const rejected = run("unsafe-reporter-refused", process.execPath, [wrapper, "--reporter=blob"]);
assert.equal(rejected.status, 2);
const summary = { root, playwright: require("@playwright/test/package.json").version, baseline: { exit: baseline.status, jsonMarkers: markers.length, passingHtmlLeak: true, failureAttachmentLeak: true },
  safeRuns, passingExit: passing.status, directBypassExit: bypass.status, missingResultExit: missing.status, rejectedReporterExit: rejected.status,
  liveCredentialsUsed: false, backendUsed: false, sourceFiles: [resolve(wrapper), resolve(reporter)] };
writeFileSync(join(root, "summary.json"), JSON.stringify(summary, null, 2));
process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
