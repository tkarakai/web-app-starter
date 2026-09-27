import { spawn } from "node:child_process";
import { demand } from "./metadata.ts";

export type CommandResult = { exitCode: number; log: string };
export type Execute = (command: string[], cwd: string) => Promise<CommandResult>;
const credential = /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ADMIN_KEY|DEPLOY_KEY|CREDENTIAL)/i;
export function childEnvironment(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^(?:GH_TOKEN|GITHUB_TOKEN|STARTER_RELEASE_TOKEN|.*UPDATER.*(?:KEY|TOKEN)|NPM_TOKEN|NODE_AUTH_TOKEN)$/.test(name)));
}
export function redact(text: string, env: Record<string, string | undefined> = process.env): string {
  // Strip terminal escapes before writing diagnostics to JSON or Markdown.
  // eslint-disable-next-line no-control-regex
  let clean = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  for (const [name, value] of Object.entries(env)) if (credential.test(name) && value && value.length >= 4) clean = clean.replaceAll(value, "[redacted]");
  clean = clean.replace(/(?:https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "https://[redacted]@");
  return clean.length <= 16384 ? clean : clean.slice(0, 4096) + "\n[... truncated ...]\n" + clean.slice(-12200);
}
export const execute: Execute = async (command, cwd) => {
  demand(command.length > 0, "Empty upgrade command");
  return new Promise(resolve => {
    const child = spawn(command[0], command.slice(1), { cwd, env: childEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    let head = "", tail = "", diagnostics = "", partial = "", context = 0, settled = false;
    const append = (chunk: Buffer) => {
      const text = chunk.toString("utf8"); head = (head + text).slice(0, 2048); tail = (tail + text).slice(-6144);
      const lines = (partial + text).split("\n"); partial = lines.pop()!.slice(-8192);
      for (const line of lines) {
        if (/(?:error:|Error:|\(fail\)|FAILED|Cannot|cannot|unable to)/.test(line)) context = 6;
        if (context > 0) { diagnostics = (diagnostics + line + "\n").slice(0, 6144); context--; }
      }
    };
    child.stdout.on("data", append); child.stderr.on("data", append);
    const finish = (exitCode: number) => { if (!settled) { settled = true; resolve({ exitCode, log: redact(head + "\n[diagnostics]\n" + diagnostics + "\n[tail]\n" + tail) }); } };
    child.on("error", error => { tail += error.message; finish(1); });
    child.on("close", code => finish(code ?? 1));
  });
};
