/** Mandatory credential-bearing test entrypoint; never forwards raw child output. */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, lstatSync, readdirSync, renameSync, constants, openSync, closeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { htmlReport, textReport, validateReport, type SafeReport } from "./secret-safe-report.ts";

export function safeArguments(input: string[]) {
  const args: string[] = []; const formats = new Set<string>();
  for (let index = 0; index < input.length; index++) {
    const value = input[index];
    if (value === "--reporter" || value.startsWith("--reporter=")) {
      const selected = value === "--reporter" ? input[++index] : value.slice(11);
      if (!selected) throw new Error("Unsupported reporter");
      for (const format of selected.split(",")) {
        if (!["list", "github", "json", "html"].includes(format)) throw new Error("Unsupported reporter");
        formats.add(format);
      }
    } else {
      if (value === "--" || /^--(?:add-reporter(?:=|$)|ui(?:-|=|$)|debug(?:=|$)|trace(?:=|$)|output(?:=|$)|list(?:=|$))/.test(value)) throw new Error("Unsupported capture or interactive override");
      args.push(value);
    }
  }
  return { args, formats };
}
export async function runSecretSafePlaywright(input: string[]): Promise<number> {
  const reportDirectory = resolve(process.env.E2E_SAFE_REPORT_DIR ?? "qa/safe-e2e-report");
  const publish = (report: SafeReport) => {
    for (const [name, body] of [["report.json", JSON.stringify(report, null, 2) + "\n"], ["index.html", htmlReport(report)]]) {
      const staging = join(reportDirectory, `.safe-${randomUUID()}`);
      const fd = openSync(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, body); } finally { closeSync(fd); }
      renameSync(staging, join(reportDirectory, name));
    }
  };
  try {
    mkdirSync(reportDirectory, { recursive: true });
    if (lstatSync(reportDirectory).isSymbolicLink()) throw new Error("Unsafe report directory");
    for (const name of readdirSync(reportDirectory)) {
      if (!["report.json", "index.html"].includes(name) || !lstatSync(join(reportDirectory, name)).isFile() || lstatSync(join(reportDirectory, name)).isSymbolicLink()) throw new Error("Unsafe report directory contents");
    }
    // Replace earlier verdicts before launch, so startup failure cannot leave stale success.
    publish({ version: 1, status: "failed", tests: [], globalErrors: ["runtime"], suppressedOutputBytes: 0 });
  } catch { process.stderr.write("Secret-safe output requires a dedicated directory without links or other artifacts.\n"); return 2; }
  let selected: ReturnType<typeof safeArguments>;
  try { selected = safeArguments(input); if (process.env.PW_TEST_REPORTER) throw new Error("Extra reporter"); }
  catch { process.stderr.write("Secret-safe runner rejected an unsupported reporter/capture override.\n"); return 2; }
  const scratch = mkdtempSync(join(tmpdir(), "playwright-secret-safe-"));
  const resultPath = join(scratch, "safe-result.json");
  const artifactPath = join(scratch, "raw-artifacts");
  let interrupted: "SIGINT" | "SIGTERM" | undefined;
  let outputBytes = 0;
  try {
    const require = createRequire(import.meta.url);
    const cli = join(dirname(require.resolve("@playwright/test/package.json")), "cli.js");
    const reporter = fileURLToPath(new URL("./secret-safe-reporter.ts", import.meta.url));
    const child = spawn(process.execPath, [cli, "test", ...selected.args, `--reporter=${reporter}`, "--trace=off", `--output=${artifactPath}`], {
      cwd: process.cwd(), env: { ...process.env, TEST_WORKER_INDEX: undefined, TEST_PARALLEL_INDEX: undefined, PLAYWRIGHT_NO_COPY_PROMPT: "1", E2E_SAFE_RUNNER: "1", E2E_SAFE_RESULT_FILE: resultPath, E2E_SAFE_REPORTER_PATH: reporter },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Consume bytes without retaining, parsing, logging or forwarding their content.
    child.stdout.on("data", (chunk: Buffer) => { outputBytes += chunk.length; });
    child.stderr.on("data", (chunk: Buffer) => { outputBytes += chunk.length; });
    const stop = (signal: "SIGINT" | "SIGTERM") => { interrupted = signal; child.kill(signal); };
    const interrupt = () => stop("SIGINT"); const terminate = () => stop("SIGTERM");
    process.once("SIGINT", interrupt); process.once("SIGTERM", terminate);
    const exit = await new Promise<number>(done => {
      child.once("error", () => done(1));
      child.once("close", (code, signal) => done(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)));
    });
    process.off("SIGINT", interrupt); process.off("SIGTERM", terminate);
    let report: SafeReport;
    try { report = validateReport(JSON.parse(readFileSync(resultPath, "utf8"))); }
    catch { report = { version: 1, status: interrupted ? "interrupted" : "failed", tests: [], globalErrors: ["runtime"], suppressedOutputBytes: outputBytes }; }
    if (interrupted) report.status = "interrupted";
    else if (exit !== 0 && report.status === "passed") report.status = "failed";
    publish(report);
    process.stdout.write(selected.formats.has("json") ? JSON.stringify(report) + "\n" : textReport(report, selected.formats.has("github") || !!process.env.GITHUB_ACTIONS));
    return interrupted ? (interrupted === "SIGINT" ? 130 : 143) : exit || (report.status === "passed" ? 0 : 1);
  } catch {
    process.stderr.write("Secret-safe browser runner failed; no raw diagnostics were published.\n"); return 1;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runSecretSafePlaywright(process.argv.slice(2));
}
