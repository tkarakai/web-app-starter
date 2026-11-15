import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { APP_IDS, type AppId } from "../packages/app-config/src/schema.ts";
import { releaseClaim, reservePorts } from "./local-ports.ts";

/**
 * Resolve once in the Playwright runner; workers and its launcher inherit the plan. The ports
 * are OS-assigned and leased to the runner until it exits, so a concurrent run in another
 * checkout never plans the same port while this run's servers are still starting.
 */
export function e2eOrigin(app: AppId): string {
  if (!process.env.PLATFORM_E2E_PORTS) {
    const { ports, claims } = reservePorts([...APP_IDS, "cloud", "site"]);
    process.once("exit", () => { for (const claim of claims) releaseClaim(claim); });
    process.env.PLATFORM_E2E_PORTS = JSON.stringify(ports);
  }
  return `http://localhost:${plannedPort(app)}`;
}

// Playwright transpiles config imports, while the launcher reads this same plan
// with Node's native TypeScript support through node-ts.sh.
export function plannedPort(name: string): number {
  const port = (JSON.parse(process.env.PLATFORM_E2E_PORTS ?? "{}") as Record<string, number>)[name];
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid E2E port for ${name}`);
  return port;
}

function rewritePorts(stateDirectory: string, ports: (previous: unknown) => unknown): boolean {
  const file = join(stateDirectory, "config.json");
  let descriptor: number;
  try {
    descriptor = openSync(file, "r+");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  try {
    const config = JSON.parse(readFileSync(descriptor, "utf8")) as Record<string, unknown>;
    config.ports = ports(config.ports);
    const content = JSON.stringify(config, null, 2) + "\n";
    writeSync(descriptor, content, 0, "utf8");
    ftruncateSync(descriptor, Buffer.byteLength(content));
  } finally {
    closeSync(descriptor);
  }
  return true;
}

/** The checkout's own saved ports, kept while a managed run uses its leased ones. */
const savedPortsFile = (directory: string) => join(directory, ".convex/platform-e2e-saved-ports.json");

const projectState = (directory: string) => join(directory, ".convex/local/default");

/** Convex probes saved ports before applying CLI overrides. Stage the checkout's state config
 * (project-local, or the legacy directory it resolves to) so another checkout's backend is
 * never probed. `directory` is packages/backend. */
export function prepareBackendPorts(directory: string, stateDirectory: string = projectState(directory)): void {
  // The record lives in packages/backend/.convex/, which Convex ignores wholesale.
  mkdirSync(join(directory, ".convex"), { recursive: true });
  if (!existsSync(join(directory, ".convex/.gitignore"))) writeFileSync(join(directory, ".convex/.gitignore"), "/*\n");
  // An interrupted run leaves the original record in place; never replace it with leased ports.
  const keep = (ports: unknown) => {
    if (!ports || existsSync(savedPortsFile(directory))) return;
    const temporary = `${savedPortsFile(directory)}.${process.pid}`;
    writeFileSync(temporary, JSON.stringify(ports) + "\n");
    renameSync(temporary, savedPortsFile(directory));
  };
  const staged = rewritePorts(stateDirectory, (previous) => {
    keep(previous);
    return { cloud: plannedPort("cloud"), site: plannedPort("site") };
  });
  if (!staged) {
    // A fresh checkout: Convex creates its state during this run. Afterwards, give it the ports
    // a first interactive start would have used.
    keep({ cloud: 3210, site: 3211 });
  }
}

/** After a managed run, give interactive `bun run dev` its usual backend ports back. */
export function restoreBackendPorts(directory: string, stateDirectory: string = projectState(directory)): void {
  if (!existsSync(savedPortsFile(directory))) return;
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(savedPortsFile(directory), "utf8"));
  } catch {
    saved = undefined; // Unreadable record: drop it rather than fail every start.
  }
  if (saved) rewritePorts(stateDirectory, () => saved);
  rmSync(savedPortsFile(directory), { force: true });
}

if (process.argv[1]?.endsWith("/e2e-ports.ts")) {
  if (process.argv[2] === "prepare-backend") {
    prepareBackendPorts(process.cwd(), process.argv[3] || undefined);
  } else if (process.argv[2] === "restore-backend") {
    restoreBackendPorts(process.cwd(), process.argv[3] || undefined);
  } else if (process.argv[2] === "shell") {
    for (const app of APP_IDS) {
      const port = plannedPort(app);
      process.stdout.write(`APP_CONFIG_PORT_${app.toUpperCase()}=${port}\nAPP_CONFIG_ORIGIN_${app.toUpperCase()}='http://localhost:${port}'\n`);
    }
  } else {
    process.stdout.write(String(plannedPort(process.argv[2])));
  }
}
