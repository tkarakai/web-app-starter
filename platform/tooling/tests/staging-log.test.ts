import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const runner = fileURLToPath(new URL("../node-ts.sh", import.meta.url));
const processor = fileURLToPath(new URL("../staging-log.ts", import.meta.url));

function convert(input: string): string {
  const result = spawnSync("bash", [runner, processor], {
    input,
    encoding: "utf8",
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout;
}

test("converts staging status symbols and colors while preserving other text", () => {
  const input = "\x1b[1;34mℹ Info\x1b[0m\n✓ Done\n✗ Failed\n⚠ Warning\n━━\n";
  assert.equal(convert(input), "[i] Info\n[ok] Done\n[FAIL] Failed\n[!] Warning\n==\n");
  assert.equal(convert("café 日本語 🚀\r\n\x1b[2K\t\x1b[mplain"), "café 日本語 🚀\r\n\x1b[2K\tplain");
});

test("handles empty input, large logs, and incomplete escapes at EOF", () => {
  assert.equal(convert(""), "");
  assert.equal(convert("\x1b[32m✓\x1b[0m\n".repeat(5000)), "[ok]\n".repeat(5000));
  for (const suffix of ["\x1b", "\x1b[", "\x1b[31;"]) {
    assert.equal(convert(`prompt: ${suffix}`), `prompt: ${suffix}`);
  }
});

test("flushes prompts before newline or EOF and handles every token split", { timeout: 10000 }, async (t) => {
  const child = spawn("bash", [runner, processor]);
  t.after(() => child.kill());
  const closed = once(child, "close");
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.stdout.setEncoding("utf8");
  const output = child.stdout[Symbol.asyncIterator]();
  async function read(expected: string): Promise<void> {
    let actual = "";
    while (actual.length < expected.length) {
      const next = await output.next();
      assert.equal(next.done, false, stderr);
      actual += next.value;
    }
    assert.equal(actual, expected);
  }

  child.stdin.write("\x1b[1m  GitHub repo: \x1b[0m");
  await read("  GitHub repo: ");

  const tokens = [
    ["ℹ", "[i]"], ["✓", "[ok]"], ["✗", "[FAIL]"],
    ["⚠", "[!]"], ["━", "="], ["🚀", "🚀"],
    ["\x1b[1;34m", ""], ["\x1b[0m", ""], ["\x1b[m", ""],
  ];
  for (const [token, replacement] of tokens) {
    const bytes = Buffer.from(token);
    for (let split = 1; split < bytes.length; split++) {
      child.stdin.write(Buffer.concat([Buffer.from("prompt: "), bytes.subarray(0, split)]));
      await read("prompt: ");
      child.stdin.write(Buffer.concat([bytes.subarray(split), Buffer.from("| ")]));
      await read(`${replacement}| `);
    }
  }
  child.stdin.end("done");
  await read("done");
  assert.equal((await output.next()).done, true);
  assert.deepEqual(await closed, [0, null]);
  assert.equal(stderr, "");
});
