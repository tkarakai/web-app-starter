import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import rawConfig from "../../app.config.ts";
import { APP_IDS, validateAppConfig, type AppId } from "../packages/app-config/src/schema.ts";

export function selectPorts(preferred: Record<string, number>, occupied: (port: number) => boolean): Record<string, number> {
  const selected: Record<string, number> = {};
  for (const [name, first] of Object.entries(preferred)) {
    let port = first;
    while (port <= first + 10 && (Object.values(selected).includes(port) || occupied(port))) port++;
    if (port > first + 10) throw new Error(`No available local port between ${first} and ${first + 10} (${name})`);
    selected[name] = port;
  }
  return selected;
}

/** Resolve once in the Playwright runner; workers and its launcher inherit the plan. */
export function e2eOrigin(app: AppId): string {
  if (!process.env.PLATFORM_E2E_PORTS) {
    const config = validateAppConfig(rawConfig);
    const preferred = Object.fromEntries(APP_IDS.map((id) => [id, config.runtime.ports[id]]));
    const ports = selectPorts({ ...preferred, cloud: 3210, site: 3211 }, (port) => {
      const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
      if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error(`Cannot inspect local port ${port}: ${result.error?.message ?? result.stderr}`);
      return result.status === 0;
    });
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

/** Convex probes saved ports before applying CLI overrides. Stage only our
 * project-local config so another checkout's anonymous-agent is never probed. */
export function prepareBackendPorts(directory: string): void {
  const file = join(directory, ".convex/local/default/config.json");
  if (!existsSync(file)) return;
  const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  config.ports = { cloud: plannedPort("cloud"), site: plannedPort("site") };
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
}

if (process.argv[1]?.endsWith("/e2e-ports.ts")) {
  if (process.argv[2] === "prepare-backend") {
    prepareBackendPorts(process.cwd());
  } else if (process.argv[2] === "shell") {
    for (const app of APP_IDS) {
      const port = plannedPort(app);
      process.stdout.write(`APP_CONFIG_PORT_${app.toUpperCase()}=${port}\nAPP_CONFIG_ORIGIN_${app.toUpperCase()}='http://localhost:${port}'\n`);
    }
  } else {
    process.stdout.write(String(plannedPort(process.argv[2])));
  }
}
