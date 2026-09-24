import { pipeline } from "node:stream/promises";

const escape = String.fromCharCode(27);
const colors = new RegExp(`${escape}\\[[0-9;]*m`, "g");
const incompleteColor = new RegExp(`${escape}(?:\\[[0-9;]*)?$`);
const symbols = new Map([
  ["ℹ", "[i]"],
  ["✓", "[ok]"],
  ["✗", "[FAIL]"],
  ["⚠", "[!]"],
  ["━", "="],
]);

process.stdin.setEncoding("utf8");
await pipeline(process.stdin, async function* (source: AsyncIterable<string>) {
  let pending = "";
  for await (const chunk of source) {
    const text = pending + chunk;
    pending = text.match(incompleteColor)?.[0] ?? "";
    yield text.slice(0, text.length - pending.length)
      .replace(colors, "")
      .replace(/[ℹ✓✗⚠━]/g, (symbol) => symbols.get(symbol)!);
  }
  yield pending;
}, process.stdout);
