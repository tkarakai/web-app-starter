import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { stop } from "./dev-processes.ts";

// Never invoke the Convex CLI here: logged-in CLI configuration can create a
// cloud project even in anonymous agent mode. The next dev launch seeds anew.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const backend = path.join(root, "packages/backend");
const state = path.join(backend, ".convex/local/default");
const envFile = path.join(backend, ".env.local");

try {
  // Refuse redirected paths before stopping services or deleting any bytes.
  for (const relative of ["packages", "packages/backend", "packages/backend/.convex", "packages/backend/.convex/local", "packages/backend/.convex/local/default", "packages/backend/.env.local"]) {
    const target = path.join(root, relative);
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
      throw new Error(`Refusing to reset a symbolic link: ${relative}`);
    }
  }
  const original = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : undefined;
  const updated = original?.split(/(?<=\n)/).filter(line => !/^\s*(?:export\s+)?(?:CONVEX_DEPLOYMENT|CONVEX_URL|CONVEX_SITE_URL)\s*=/.test(line)).join("");
  stop(root);
  fs.rmSync(state, { recursive: true, force: true });
  if (updated !== undefined && updated !== original) fs.writeFileSync(envFile, updated);
} catch (error) {
  console.error(`Local database reset: ${(error as Error).message}`);
  process.exitCode = 1;
}
