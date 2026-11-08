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

let envDescriptor: number | undefined;
try {
  // Refuse redirected paths before stopping services or deleting any bytes.
  for (const relative of ["packages", "packages/backend", "packages/backend/.convex", "packages/backend/.convex/local", "packages/backend/.convex/local/default", "packages/backend/.env.local"]) {
    const target = path.join(root, relative);
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
      throw new Error(`Refusing to reset a symbolic link: ${relative}`);
    }
  }
  try {
    envDescriptor = fs.openSync(envFile, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
    if (!fs.fstatSync(envDescriptor).isFile()) throw new Error("Backend environment must be a regular file");
  } catch (error) {
    if ((error as Error & { code?: string }).code !== "ENOENT") throw error;
  }
  const original = envDescriptor === undefined ? undefined : fs.readFileSync(envDescriptor, "utf8");
  const updated = original?.split(/(?<=\n)/).filter(line => !/^\s*(?:export\s+)?(?:CONVEX_DEPLOYMENT|CONVEX_URL|CONVEX_SITE_URL)\s*=/.test(line)).join("");
  stop(root);
  fs.rmSync(state, { recursive: true, force: true });
  if (envDescriptor !== undefined && updated !== undefined && updated !== original) {
    // Keep the verified open file: reopening its path could follow a replacement link.
    fs.writeSync(envDescriptor, updated, 0, "utf8");
    fs.ftruncateSync(envDescriptor, Buffer.byteLength(updated));
  }
} catch (error) {
  console.error(`Local database reset: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  if (envDescriptor !== undefined) fs.closeSync(envDescriptor);
}
