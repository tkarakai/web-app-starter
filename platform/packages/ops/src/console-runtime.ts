import { createInterface } from "node:readline/promises";
import { emitKeypressEvents, type Key } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { authStatus, githubApi, vercelApi } from "./auth";
import { loadConfig } from "./config";
import { OperationsConsole } from "./console";
import { OpsError, errorInfo, redact } from "./errors";
import { query, type Report } from "./operations";
import type { Options } from "./options";
import { render, safeCell, sanitizeLinks } from "./output";
import { opsRoll, promptError, terminalSelect } from "./prompts";
import { OpsService } from "./service";
import { sessionStore } from "./session";
import { setup } from "./setup";

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const abort = new globalThis.AbortController();
  let back = false;
  const onKey = (_text: string, key: Key) => { if (key.name === "escape") { back = true; abort.abort(); } };
  emitKeypressEvents(process.stdin, rl);
  process.stdin.on("keypress", onKey);
  rl.once("SIGINT", () => abort.abort());
  rl.once("close", () => abort.abort());
  try { return await rl.question(safeCell(question), { signal: abort.signal }); }
  catch {
    if (back) return "";
    throw new OpsError("INTERRUPTED", "Console closed; remote work continues.", "Run ops to resume monitoring.", 130);
  } finally { process.stdin.off("keypress", onKey); rl.close(); }
}
export async function startConsole(base: Options) {
  const controller = new globalThis.AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  base = { ...base, signal: controller.signal };
  const store = sessionStore(base.config);
  const tell = (message: string) => opsRoll.append(message.split("\n"));
  const show = (report: Report) => {
    const lines: string[] = [];
    render(report.command ?? "evidence", { ...(report.data ?? {}), observedAt: report.observedAt, coverage: report.coverage }, false,
      report.errors.map(e => new OpsError(e.code, e.message, e.hint, 1, e.details)), report.warnings,
      { log: line => lines.push(line), error: line => lines.push(line) });
    const titles: Record<string, string> = { status: "Environment details", history: "Deployment history", diagnose: "Deployment investigation",
      verify: "Serving verification", inspect: "Release review", candidates: "Release candidates", diff: "Release comparison",
      logs: "Failed-job logs", watch: "Workflow progress", deploy: "Deployment request", rollback: "Rollback request", doctor: "Configuration check" };
    opsRoll.write({ title: titles[report.command ?? ""] ?? "Operation details", lines });
  };
  const guided = new OperationsConsole(base, {
    ui: { select: terminalSelect, ask, tell, show, load: async (command, work) => {
      const titles: Record<string, string> = { status: "Checking environments…", history: "Loading deployment history…", runs: "Loading workflow runs…",
        inspect: "Preparing release review…", candidates: "Loading release candidates…", diagnose: "Investigating this deployment…",
        logs: "Loading failed-job logs…", deploy: "Checking deployment request…", rollback: "Checking rollback request…",
        request: "Looking for the requested deployment…", auth: "Checking account access…", doctor: "Checking configuration…", diff: "Comparing releases…" };
      try { return await opsRoll.wait(titles[command] ?? "Loading details…", work, controller.signal); }
      catch (error) { return promptError(error); }
    } }, load: store.load, save: store.save,
    setup: async () => { const result = await setup({ ...base, command: "setup", args: [], json: false }, () => {}); render("setup", result, false); },
    query: async options => {
      if (options.command === "auth") {
        const result = await authStatus();
        return { data: result.data, errors: result.errors.map(errorInfo), warnings: [], coverage: [], observedAt: new Date().toISOString() };
      }
      const config = await loadConfig(options.config, options.repo);
      if (options.expectedRepository && config.repository !== options.expectedRepository) throw new OpsError("SESSION_REPOSITORY", "The saved operation belongs to a different repository.", "Restore the original repository configuration before resuming. No request was sent.", 2);
      // A fresh service keeps concurrent background reads' evidence/errors isolated.
      return query(new OpsService(config, githubApi(undefined, controller.signal), vercelApi(undefined, controller.signal), options.config), options);
    },
    export: async report => {
      const directory = resolve(".ops-reports"); await mkdir(directory, { recursive: true });
      const path = resolve(directory, `observation-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.json`);
      await writeFile(path, `${redact(JSON.stringify(sanitizeLinks({ schemaVersion: 1, ...report }), null, 2))}\n`, { flag: "wx", mode: 0o600 });
      tell(`Saved observation: ${path}`);
    },
  });
  try { await guided.run(); }
  finally { process.stdin.pause(); controller.abort(); process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); tell("Operations console closed. Any remote deployment continues."); opsRoll.finish(); }
}
