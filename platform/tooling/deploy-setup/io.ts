import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
export type Run = (file: string, args: string[], input?: string, env?: Record<string, string>, cwd?: string) => Promise<string>;
// Never include subprocess output/arguments in errors: provider errors can echo request secrets.
export class CommandError extends Error { status?: number; constructor(file: string, code: number | null, status?: number) { super(`${file} failed (exit ${code}); check provider access and resume. Provider output was withheld to protect credentials.`); this.status = status; } }
export const run: Run = (file, args, input, env, cwd) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env, NO_COLOR: "1" } });
  let out = "", err = "";
  const timer = setTimeout(() => { child.kill(); reject(Error(`${file} timed out; check authentication/connectivity and resume.`)); }, 60_000);
  child.stdout.on("data", chunk => { out += chunk; });
  child.stderr.on("data", chunk => { err += chunk; });
  child.on("error", () => { clearTimeout(timer); reject(Error(`Cannot start ${file}; install its CLI and resume.`)); });
  child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(out.trim() || err.trim()); else reject(new CommandError(file, code, Number(/HTTP (\d{3})/.exec(err)?.[1]) || undefined)); });
  child.stdin.on("error", () => {});
  child.stdin.end(input);
});
export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(`${question}: `)).trim(); } finally { rl.close(); }
}
export async function hidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw Error("Secrets require an interactive terminal; never send them through chat or command arguments.");
  process.stdout.write(`${question} (hidden): `);
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true); process.stdin.resume();
    const finish = () => { process.stdin.off("data", data); process.stdin.setRawMode(wasRaw); process.stdin.pause(); process.stdout.write("\n"); };
    const data = (chunk: Buffer) => {
      for (const c of chunk.toString()) {
        if (c === "\u0003" || c === "\u0004") { finish(); reject(Error("Setup interrupted; rerun deploy:setup to resume.")); return; }
        if (c === "\r" || c === "\n") { finish(); if (value.trim()) resolve(value.trim()); else reject(Error("Empty credential; rerun setup.")); return; }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else if (c >= " " && c !== "\u001b") value += c;
      }
    };
    process.stdin.on("data", data);
  });
}
export async function interactive(file: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit" });
    child.once("error", () => reject(Error(`Cannot start ${file}`)));
    child.once("exit", code => code === 0 ? resolve() : reject(Error(`${file} did not complete; resume setup later.`)));
  });
}
export class HttpError extends Error { status: number; constructor(status: number, provider: string) { super(`${provider} API returned ${status}; check access and resume.`); this.status = status; } }
export async function api<T>(base: string, endpoint: string, token: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(base + endpoint, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok) throw new HttpError(response.status, new URL(base).hostname);
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; } catch { throw Error(`${new URL(base).hostname} returned invalid JSON; response withheld to protect credentials.`); }
}
