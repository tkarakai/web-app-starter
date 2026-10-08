import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Shared by native CI, GitHub CI and the upgrade verifier. The online profile
// covers registry audit and published advisories; CodeQL stays in GitHub Security.
export const CHECKOUT_CHECKS = ["check:runtime-baseline", "check:agent-skills", "check:actions-pinned", "check:i18n"] as const;
export const PLATFORM_CHECKS = ["typecheck:dev-scripts", "lint:dev-scripts", "test:dev-scripts", "test:ops", "test:auth-ui", "test:agentic", "test:shared-packages"] as const;
export const ONLINE_CHECKS = ["check:dependencies", "check:advisories"] as const;
export const UPGRADE_CHECKS = [...ONLINE_CHECKS, ...CHECKOUT_CHECKS, ...PLATFORM_CHECKS, "lint", "typecheck", "test", "test:unit", "test:convex", "test:contracts", "build", "test:startup", "test:landing-artifacts", "test:e2e"] as const;
export function checksFor(profile: string, root: string): readonly string[] {
  switch (profile) {
    case "checkout": return [...CHECKOUT_CHECKS, "check:zone", ...(existsSync(resolve(root, ".platform-base.json")) ? [] : ["check:dependency-floors"])];
    case "platform": return PLATFORM_CHECKS;
    case "contracts": return ["test:contracts"];
    case "online": return ONLINE_CHECKS;
    default: throw new Error(`Unknown CI profile: ${profile}`);
  }
}
export function runChecks(profile: string, root = process.cwd(), run = (script: string) => spawnSync("bun", ["run", script], { cwd: root, stdio: "inherit" }).status ?? 1): void {
  for (const script of checksFor(profile, root)) {
    console.log(`[${profile}] ${script}`);
    if (run(script) !== 0) throw new Error(`CI check failed: ${script}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runChecks(process.argv[2]); } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
