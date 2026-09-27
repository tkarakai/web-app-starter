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
  return clean.replace(/(?:https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "https://[redacted]@").slice(-16384);
}
export const execute: Execute = async (command, cwd) => {
  demand(command.length > 0, "Empty upgrade command");
  return new Promise(resolve => {
    const child = spawn(command[0], command.slice(1), { cwd, env: childEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    let tail = "", settled = false;
    const append = (chunk: Buffer) => { tail = (tail + chunk.toString("utf8")).slice(-65536); };
    child.stdout.on("data", append); child.stderr.on("data", append);
    const finish = (exitCode: number) => { if (!settled) { settled = true; resolve({ exitCode, log: redact(tail) }); } };
    child.on("error", error => { tail += error.message; finish(1); });
    child.on("close", code => finish(code ?? 1));
  });
};
