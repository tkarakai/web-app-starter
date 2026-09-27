import { expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { PaperRoll, type Input, type Output } from "../src/index";
import { cells, clip, plain } from "../src/text";

function terminal(rows = 24, columns = 80) {
  const input = new PassThrough() as Input;
  input.isTTY = true; input.isRaw = false; input.setRawMode = raw => { input.isRaw = raw; };
  input.pause();
  let raw = "";
  const output = new Writable({ write(chunk, _encoding, done) { raw += chunk.toString(); done(); } }) as Output;
  output.isTTY = true; output.rows = rows; output.columns = columns;
  // Interpret the renderer's cursor-up/erase operations, so assertions inspect
  // what survives in scrollback rather than obsolete frames in the byte stream.
  const screen = () => {
    let line = 0, column = 0;
    const lines: string[] = [""];
    // eslint-disable-next-line no-control-regex
    for (const part of raw.matchAll(/\x1b\[[0-9;?]*[A-Za-z]|[^\x1b]/gu)) {
      const value = part[0];
      if (value.startsWith("\x1b")) {
        if (value.endsWith("A")) line = Math.max(0, line - Number(value.slice(2, -1)));
        if (value.endsWith("J")) { lines.splice(line + 1); lines[line] = (lines[line] ?? "").slice(0, column); }
      } else if (value === "\r") column = 0;
      else if (value === "\n") { line++; column = 0; lines[line] ??= ""; }
      else { lines[line] = (lines[line] ?? "").slice(0, column) + value + (lines[line] ?? "").slice(column + value.length); column += value.length; }
    }
    return lines.join("\n");
  };
  return { input, output, screen, raw: () => raw, roll: new PaperRoll({ input, output, color: false }),
    key: (name: string, ctrl = false) => input.emit("keypress", "", { name, ctrl }) };
}
const choices = [{ id: "inspect", label: "Inspect files", value: { action: "inspect" } }, { id: "quit", label: "Quit", value: { action: "quit" } }];
const delay = (ms = 130) => new Promise(resolve => setTimeout(resolve, ms));
test("passive observation updates without a menu or invented selection, then commits completion", async () => {
  const t = terminal(); let completed = false;
  const observation = t.roll.choose({ observe: true, back: true, prompt: "Watching automatically. No keypress needed.",
    choices: [{ id: "actions", label: "Actions", value: "actions" }], complete: () => completed,
    section: () => ({ title: "Watching deployment", lines: [completed ? "Complete" : "Now: E2E tests"] }) });
  expect(t.screen()).toContain("Now: E2E tests"); expect(t.screen()).toContain("Enter Actions");
  expect(t.screen()).not.toContain("↑/↓"); expect(t.screen()).not.toContain("› Actions");
  completed = true; expect(await observation).toEqual({ kind: "complete" });
  expect(t.screen()).toContain("Complete\n──"); expect(t.screen()).not.toContain("› Actions");
  expect(t.input.isRaw).toBe(false);
});
test("Enter explicitly opens observation actions and Escape returns without selecting one", async () => {
  for (const key of ["return", "escape"]) {
    const t = terminal();
    const observation = t.roll.choose({ observe: true, back: true, prompt: "Watching", choices: [{ id: "actions", label: "Actions", value: "actions" }],
      section: () => ({ title: "Progress", lines: ["Still running"] }) });
    t.key(key);
    expect(await observation).toEqual(key === "return" ? { kind: "selected", value: "actions" } : { kind: "back" });
    expect(t.screen()).toContain("Still running\n──");
  }
});

test("choice is part of its output section; the separator follows the output, never the choice", async () => {
  const t = terminal();
  t.roll.write({ title: "Overview", lines: ["3 files"] });
  const select = t.roll.choose({ prompt: "Next?", choices });
  t.key("return"); expect(await select).toEqual({ kind: "selected", value: { action: "inspect" } });
  t.roll.write({ title: "Files", lines: ["first", "second", "third"] });
  const text = t.screen();
  expect(text).toContain("› Inspect files\n\nFiles\n\nfirst\nsecond\nthird\n──");
  expect(text).not.toContain("Next?"); expect(text).not.toContain("↑/↓");
  expect(text.split("─".repeat(72))).toHaveLength(3);
  expect(t.input.isRaw).toBe(false); expect(t.input.isPaused()).toBe(true);
});
test("task replaces its loading header and freezes the result in scrollback", async () => {
  const t = terminal();
  let ready!: (value: number) => void;
  const task = t.roll.task({ title: "Count", loading: "Counting…", run: () => new Promise<number>(resolve => { ready = resolve; }), render: count => [`${count} files`] });
  expect(t.screen()).toContain("Counting…");
  ready(3); expect(await task).toBe(3);
  expect(t.screen()).toContain("Count\n\n3 files\n──"); expect(t.screen()).not.toContain("Counting…");
  const prior = t.screen();
  const select = t.roll.choose({ prompt: "Next?", choices });
  t.key("down"); t.key("up"); t.key("return"); await select;
  expect(t.screen().startsWith(prior)).toBe(true);
});
test("follow-up questions stay with the selected action until there is output to close", async () => {
  const t = terminal();
  const first = t.roll.choose({ prompt: "Action?", choices });
  t.key("return"); await first;
  const second = t.roll.choose({ prompt: "Which folder?", choices: [{ id: "current", label: "Current directory", value: "." }] });
  expect(t.screen()).not.toContain("─");
  t.key("return"); await second;
  t.roll.write({ title: "Files", lines: ["one file"] });
  expect(t.screen()).toContain("› Inspect files\n\n› Current directory\n\nFiles\n\none file\n──");
});
test("callers can restore the highlighted choice after a cancelled navigation request", async () => {
  const t = terminal(); let highlighted = "inspect";
  const first = t.roll.choose({ prompt: "Next?", choices, back: true, onHighlight: choice => { highlighted = choice.id; } });
  t.key("down"); t.key("escape"); expect(await first).toEqual({ kind: "back" });
  expect(highlighted).toBe("quit");
  const resumed = t.roll.choose({ prompt: "Next?", choices, initial: highlighted });
  t.key("return"); expect(await resumed).toEqual({ kind: "selected", value: { action: "quit" } });
});
test("live content becomes one final section; updated choices keep selection by ID", async () => {
  const t = terminal();
  let entries = choices, count = 1;
  const select = t.roll.choose({ prompt: "Next?", choices: () => entries,
    section: () => ({ title: "Files", lines: [`${count} files`] }) });
  t.key("down");
  entries = [choices[1], choices[0]]; count = 2; await delay();
  t.key("return"); expect(await select).toEqual({ kind: "selected", value: { action: "quit" } });
  expect(t.screen()).toContain("2 files"); expect(t.screen()).not.toContain("1 files");
  expect(t.screen().match(/Files/g)).toHaveLength(1);
});
test("Back and interruption retain context and restore input and listeners", async () => {
  for (const action of ["escape", "c"]) {
    const t = terminal(); const count = process.listenerCount("SIGINT");
    const select = t.roll.choose({ prompt: "Next?", choices, back: true, section: () => ({ title: "Overview", lines: ["Some output"] }) });
    const outcome = select.catch(error => error);
    t.key(action, action === "c");
    const result = await outcome;
    if (action === "escape") expect(result).toEqual({ kind: "back" });
    else expect(result.code).toBe("INTERRUPTED");
    expect(t.screen()).toContain("Some output\n──");
    expect(t.input.isRaw).toBe(false); expect(t.input.isPaused()).toBe(true);
    expect(t.input.listenerCount("keypress")).toBe(0); expect(process.listenerCount("SIGINT")).toBe(count);
    expect(t.raw()).toContain("\x1b[?25h");
  }
});
test("aborting a task returns promptly even if domain work ignores its signal", async () => {
  const t = terminal(); const controller = new globalThis.AbortController();
  const task = t.roll.task({ title: "Slow work", signal: controller.signal, run: () => new Promise<never>(() => {}), render: () => [] });
  const outcome = task.catch(error => error);
  controller.abort(); expect((await outcome).code).toBe("INTERRUPTED");
  expect(t.screen()).toContain("Slow work\n\nInterrupted.\n──");
  t.roll.write({ title: "Still usable", lines: [] });
});
test("errors leave a readable section and the original error reaches the caller", async () => {
  const t = terminal(); const error = new Error("Unavailable");
  const result = await t.roll.task({ title: "Files", run: async () => { throw error; }, render: () => [] }).catch(error => error);
  expect(result).toBe(error); expect(t.screen()).toContain("Could not complete: Unavailable\n──");
});
test("small terminals keep choices accessible and commit the full output", async () => {
  const t = terminal(12, 40); const lines = Array.from({ length: 30 }, (_, i) => `Record ${i}`);
  const select = t.roll.choose({ prompt: "Next?", choices, section: () => ({ title: "History", lines }) });
  expect(t.screen()).toContain("Inspect files"); expect(t.screen()).toContain("Quit");
  expect(t.screen().split("\n").length).toBeLessThanOrEqual(12);
  t.key("return"); await select;
  expect(t.screen()).toContain("Record 0"); expect(t.screen()).toContain("Record 29");
});
test("automatic completion cleans up the menu without inventing a user decision", async () => {
  const t = terminal();
  const result = await t.roll.choose({ prompt: "Next?", choices, complete: () => true, section: () => ({ title: "Operation found", lines: ["Ready"] }) });
  expect(result).toEqual({ kind: "complete" }); expect(t.screen()).not.toContain("›"); expect(t.screen()).toContain("Ready\n──");
});
test("noninteractive output is readable but choices fail without hanging", async () => {
  const t = terminal(); t.output.isTTY = false;
  await t.roll.task({ title: "Files", run: async () => 3, render: n => [`${n} files`] });
  expect(t.raw()).not.toContain("\x1b");
  expect((await t.roll.choose({ prompt: "Next?", choices }).catch(error => error)).code).toBe("INTERACTIVE_REQUIRED");
});
test("untrusted text cannot inject terminal controls, and clipping preserves graphemes", () => {
  expect(plain("safe\x1b[2J\x1b]0;title\x07name\r")).toBe("safename ");
  expect(clip("a👩‍💻bc", 4)).toBe("a👩‍💻…"); expect(cells("部署")).toBe(4);
  const t = terminal(); t.roll.write({ title: "Result", lines: ["line one\nline two", "bad\x1b[2J"] });
  expect(t.raw()).not.toContain("\x1b[2J"); expect(t.screen()).toContain("line one\nline two");
});
