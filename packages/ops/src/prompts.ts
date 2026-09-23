import { emitKeypressEvents, cursorTo, moveCursor, clearScreenDown, type Key } from "node:readline";
import { OpsError } from "./errors";
import { safeCell } from "./output";

export type Select = (label: string, choices: string[], initial?: number) => Promise<number>;

export const terminalSelect: Select = async (label, choices, initial = 0) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new OpsError("INTERACTIVE_REQUIRED", "Selection requires an interactive terminal.", "Run ops setup in a terminal without --json.", 2);
  if (!choices.length || initial < 0 || initial >= choices.length) throw new OpsError("INVALID_CHOICES", "The selection menu has no valid starting choice.", "Retry setup with --debug.");
  console.log(label.split("\n").map(line => line ? safeCell(line) : "").join("\n"));
  const input = process.stdin, output = process.stdout;
  const wasRaw = input.isRaw, wasPaused = input.isPaused();
  let selected = initial, renderedLines = 0;
  const text = (value: string) => {
    const clean = safeCell(value), width = Math.max(1, (output.columns || 80) - 2);
    return clean.length > width ? `${clean.slice(0, width - 1)}…` : clean;
  };
  const clear = () => {
    if (renderedLines) { cursorTo(output, 0); moveCursor(output, 0, -renderedLines); clearScreenDown(output); }
    renderedLines = 0;
  };
  const draw = () => {
    clear();
    const count = Math.min(8, Math.max(1, (output.rows || 24) - 6), choices.length);
    const start = Math.max(0, Math.min(selected - Math.floor(count / 2), choices.length - count));
    for (let index = start; index < start + count; index++) {
      const row = text(`${selected === index ? "›" : " "} ${choices[index]}`);
      output.write(selected === index && !process.env.NO_COLOR ? `\x1b[7m${row}\x1b[0m\n` : `${row}\n`);
    }
    output.write(`${text(`↑/↓ Move · Enter Select · Esc Cancel (${selected + 1}/${choices.length})`)}\n`);
    renderedLines = count + 1;
  };
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      input.off("keypress", onKey);
      input.off("end", cancel);
      input.off("error", finish);
      output.off("resize", onResize);
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
      input.setRawMode(Boolean(wasRaw));
      if (wasPaused) input.pause();
      clear();
      output.write("\x1b[?25h");
      if (error) reject(error);
      else { output.write(`  ${text(choices[selected])}\n`); resolve(); }
    };
    const cancel = () => finish(new OpsError("INTERRUPTED", "Setup cancelled; configuration was not saved.", "Run ops setup to start again.", 130));
    const onResize = () => { try { draw(); } catch (error) { finish(error); } };
    const onKey = (_value: string, key: Key) => {
      try {
        if (key.name === "escape" || (key.ctrl && ["c", "d"].includes(key.name ?? ""))) { cancel(); return; }
        if (key.name === "return" || key.name === "enter") { finish(); return; }
        if (key.name === "up") selected = (selected + choices.length - 1) % choices.length;
        else if (key.name === "down") selected = (selected + 1) % choices.length;
        else if (key.name === "home") selected = 0;
        else if (key.name === "end") selected = choices.length - 1;
        else return;
        draw();
      } catch (error) { finish(error); }
    };
    emitKeypressEvents(input);
    input.on("keypress", onKey);
    input.once("end", cancel);
    input.once("error", finish);
    output.on("resize", onResize);
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try { input.setRawMode(true); input.resume(); output.write("\x1b[?25l"); draw(); }
    catch (error) { finish(error); }
  });
  return selected;
};
