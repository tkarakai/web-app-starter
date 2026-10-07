/** Credential-free scripts and an interactive CLI; its grant stays only in this process. */
import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { authenticate } from "./auth";
import { connectCli } from "./cli-client";
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
async function main() {
  if (args.includes("--help")) { process.stdout.write('Admin CLI: --origin <origin> [--script <JSON file>]\nCommands are JSON objects: {"operation":"search|describe|execute","input":{...}}. Interactive /auth renews access; /quit exits. No tokens are written to disk.\n'); return; }
  const origin = option("--origin") ?? "http://localhost:3002";
  let client = connectCli(origin, await authenticate(origin, "cli"));
  async function command(value: unknown) {
    if (!value || typeof value !== "object") throw new Error("Expected a JSON command");
    const { operation, input } = value as { operation?: string; input?: Record<string, unknown> };
    const name = { search: "capabilities_search", describe: "capabilities_describe", execute: "capabilities_execute" }[operation ?? ""];
    if (!name) throw new Error("Use search, describe or execute");
    const result = await client.callTool({ name, arguments: input });
    const content = result.content as { text?: string }[];
    process.stdout.write((content[0]?.text ?? "null") + "\n");
    if (result.isError) throw new Error("CLI operation failed");
  }
  const script = option("--script");
  if (script) {
    try { const commands: unknown = JSON.parse(await readFile(script, "utf8")); if (!Array.isArray(commands) || commands.length > 100) throw new Error("Script must contain at most 100 commands"); for (const value of commands) await command(value); }
    finally { await client.close(); }
    return;
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("Admin CLI ready. Enter a JSON command, /auth or /quit.\n");
    for (;;) {
      const text = await terminal.question("admin> ");
      if (text.trim() === "/quit") break;
      try {
        if (text.trim() === "/auth") client = connectCli(origin, await authenticate(origin, "cli"));
        else if (text.trim()) await command(JSON.parse(text));
      } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Command failed"}\n`); }
    }
  } finally { terminal.close(); await client.close(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "CLI failed"}\n`); process.exitCode = 1; });
