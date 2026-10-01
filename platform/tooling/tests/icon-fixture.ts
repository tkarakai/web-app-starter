import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export function copyConfiguredIcons(checkout: string, source: string): void {
  const sourceRoot = fs.realpathSync(source);
  for (const key of ["svg", "ico", "appleTouchIcon"]) {
    const name = execFileSync(path.join(checkout, "platform/tooling/node-ts.sh"), [
      path.join(checkout, "platform/tooling/app-config.ts"), "get", `brand.icons.${key}`,
    ], { encoding: "utf8", stdio: "pipe" }).trim();
    const original = fs.realpathSync(path.join(sourceRoot, name));
    const relative = path.relative(sourceRoot, original);
    assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `Icon source is outside source checkout: ${name}`);
    assert.ok(fs.statSync(original).isFile(), `Icon source must be a file: ${name}`);
    const destination = path.join(checkout, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(original, destination);
  }
}
