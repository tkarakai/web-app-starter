import { emitKeypressEvents, type Key } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { cells, clip, plain } from "./text";
type AbortSignal = globalThis.AbortSignal;

export interface Section { title: string; lines?: readonly string[]; pending?: boolean }
export interface Choice<T> { id: string; label: string; value: T }
export type Selection<T> = { kind: "selected"; value: T } | { kind: "back" } | { kind: "complete" };
export interface ChooseOptions<T> {
  prompt: string;
  choices: readonly Choice<T>[] | (() => readonly Choice<T>[]);
  initial?: string;
  section?: () => Section;
  back?: boolean;
  complete?: () => boolean;
  onHighlight?: (choice: Choice<T>) => void;
  /** A passive live section: Enter opens the single action; no menu is shown. */
  observe?: boolean;
  signal?: AbortSignal;
}
export interface Input extends Readable { isTTY?: boolean; isRaw?: boolean; setRawMode?(raw: boolean): unknown }
export interface Output extends Writable { isTTY?: boolean; columns?: number; rows?: number }
export interface PaperRollOptions {
  input?: Input; output?: Output; color?: boolean;
  /** Domain-owned secret redaction, applied before terminal-control sanitization. */
  sanitize?: (text: string) => string;
}
export class PaperRollError extends Error {
  constructor(public code: "INTERACTIVE_REQUIRED" | "INTERRUPTED" | "BUSY" | "INVALID_CHOICES", message: string) { super(message); }
}

/** An append-only transcript with one replaceable frame at its tail. */
export class PaperRoll {
  private input: Input;
  private output: Output;
  private options: PaperRollOptions;
  private frame: string[] = [];
  private open: "action" | "output" | false = false;
  private busy = false;
  constructor(options: PaperRollOptions = {}) {
    this.options = options; this.input = options.input ?? process.stdin; this.output = options.output ?? process.stdout;
  }
  private line(value: string) { return plain(this.options.sanitize?.(value) ?? value); }
  private get width() { return Math.max(2, (this.output.columns || 80) - 1); }
  private get height() { return Math.max(5, this.output.rows || 24); }
  private separator() { return "─".repeat(Math.min(72, this.width)); }
  private print(lines: readonly string[]) { this.output.write(lines.flatMap(line => line.split("\n").map(part => this.line(part))).join("\n") + "\n"); }
  private idle() { if (this.busy) throw new PaperRollError("BUSY", "Await the active prompt or task before writing another section."); }
  private clear() {
    if (!this.frame.length) return;
    const rows = this.frame.reduce((n, line) => n + Math.max(1, Math.ceil(cells(line) / Math.max(1, this.output.columns || 80))), 0);
    this.output.write(`\r\x1b[${Math.min(rows, this.height - 1)}A\x1b[J`);
    this.frame = [];
  }
  private draw(lines: readonly string[], selectedLine = -1) {
    this.clear();
    this.frame = lines.map(line => clip(this.line(line), this.width));
    for (const [index, line] of this.frame.entries()) {
      const highlight = index === selectedLine && (this.options.color ?? !process.env.NO_COLOR);
      this.output.write(highlight ? `\x1b[7m${line}\x1b[0m\n` : `${line}\n`);
    }
  }
  private content(section: Section, frame = 0) {
    return [section.pending ? `${["⠋", "⠙", "⠹", "⠸"][frame % 4]} ${section.title}` : section.title,
      ...(section.lines?.length ? ["", ...section.lines] : [])];
  }
  /** Append text to the selected action's output; finish() closes that section. */
  append(lines: readonly string[]) { this.idle(); this.print(lines); this.open = "output"; }
  finish() { this.idle(); if (this.open) { this.print([this.separator(), ""]); this.open = false; } }
  /** Commit a complete, named result, followed by its separator. No clipping in scrollback. */
  write(section: Section) { this.idle(); this.print(this.content(section)); this.open = "output"; this.finish(); }

  /** A temporary loading header, replaced by the caller's next write or choose. */
  async wait<T>(title: string, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.idle(); this.busy = true;
    const controller = new globalThis.AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    process.on("SIGINT", abort); process.on("SIGTERM", abort);
    let timer: ReturnType<typeof setInterval> | undefined, frame = 0;
    let onAbort: (() => void) | undefined;
    try {
      if (signal?.aborted) controller.abort();
      if (controller.signal.aborted) throw new PaperRollError("INTERRUPTED", "Interaction interrupted.");
      if (this.output.isTTY) {
        this.output.write("\x1b[?25l");
        this.draw(this.content({ title, pending: true }));
        timer = setInterval(() => this.draw(this.content({ title, pending: true }, ++frame)), 100);
      } else this.print([title]);
      return await Promise.race([work(controller.signal), new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new PaperRollError("INTERRUPTED", "Interaction interrupted."));
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
      })]);
    } finally {
      if (timer) clearInterval(timer);
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
      signal?.removeEventListener("abort", abort);
      process.off("SIGINT", abort); process.off("SIGTERM", abort);
      this.clear(); if (this.output.isTTY) this.output.write("\x1b[?25h"); this.busy = false;
    }
  }
  /** Run domain work and commit its rendered result. Failures remain visible and are rethrown. */
  async task<T>(options: { title: string; loading?: string; run: (signal: AbortSignal) => Promise<T>; render: (value: T) => readonly string[]; signal?: AbortSignal }): Promise<T> {
    try {
      const value = await this.wait(options.loading ?? `Loading ${options.title}…`, options.run, options.signal);
      this.write({ title: options.title, lines: options.render(value) }); return value;
    } catch (error) {
      this.write({ title: options.title, lines: [error instanceof PaperRollError && error.code === "INTERRUPTED" ? "Interrupted." : `Could not complete: ${error instanceof Error ? error.message : String(error)}`] });
      throw error;
    }
  }
  async choose<T>(options: ChooseOptions<T>): Promise<Selection<T>> {
    this.idle();
    if (!this.input.isTTY || !this.output.isTTY || !this.input.setRawMode) throw new PaperRollError("INTERACTIVE_REQUIRED", "Choices require an interactive terminal.");
    const readChoices = () => {
      const choices = typeof options.choices === "function" ? options.choices() : options.choices;
      if (!choices.length || new Set(choices.map(c => c.id)).size !== choices.length) throw new PaperRollError("INVALID_CHOICES", "Provide at least one choice and unique choice IDs.");
      if (options.observe && choices.length !== 1) throw new PaperRollError("INVALID_CHOICES", "An observation has exactly one Enter action.");
      return choices;
    };
    let choices = readChoices();
    let selected = options.initial ?? choices[0].id;
    if (!choices.some(c => c.id === selected)) throw new PaperRollError("INVALID_CHOICES", "The initial choice does not exist.");
    if (!options.section && this.open === "output") this.finish();
    this.busy = true;
    const input = this.input, output = this.output;
    const wasRaw = input.isRaw, wasFlowing = input.readableFlowing === true;
    let section: Section | undefined, tick = 0, previous = "", highlighted: string | undefined;
    return new Promise<Selection<T>>((resolve, reject) => {
      let settled = false, timer: ReturnType<typeof setInterval> | undefined;
      const finish = (result?: Selection<T>, error?: unknown) => {
        if (settled) return; settled = true;
        if (!error && options.section) { try { section = options.section(); } catch (cause) { error = cause; } }
        if (timer) clearInterval(timer);
        input.off("keypress", onKey); input.off("end", cancel); input.off("error", fail); output.off("resize", resize);
        process.off("SIGINT", cancel); process.off("SIGTERM", cancel); options.signal?.removeEventListener("abort", cancel);
        input.setRawMode!(Boolean(wasRaw)); if (!wasFlowing) input.pause();
        this.clear(); output.write("\x1b[?25h"); this.busy = false;
        if (section) this.write({ ...section, pending: false, lines: section.pending ? [...section.lines ?? [], "Left before loading finished."] : section.lines });
        if (error) {
          this.append([error instanceof PaperRollError && error.code === "INTERRUPTED" ? "Interrupted." : `Could not display choices: ${error instanceof Error ? error.message : String(error)}`]);
          this.finish(); reject(error); return;
        }
        // This choice starts the next section. Its separator comes AFTER its output.
        if (result?.kind !== "complete") {
          this.print([`› ${result?.kind === "back" ? "Back" : choices.find(c => c.id === selected)!.label}`, ""]);
          this.open = "action";
        }
        resolve(result!);
      };
      const fail = (error: unknown) => finish(undefined, error);
      const cancel = () => fail(new PaperRollError("INTERRUPTED", "Interaction interrupted."));
      const draw = (force = false) => {
        choices = readChoices();
        if (!choices.some(c => c.id === selected)) selected = choices[0].id;
        if (highlighted !== selected) { options.onHighlight?.(choices.find(c => c.id === selected)!); highlighted = selected; }
        section = options.section?.();
        const state = JSON.stringify([choices.map(c => [c.id, c.label]), selected, section, section?.pending ? tick++ : 0]);
        if (!force && state === previous) return;
        previous = state;
        const count = options.observe ? 0 : Math.min(8, choices.length, Math.max(1, this.height - (section ? 7 : 4)));
        const index = choices.findIndex(c => c.id === selected);
        const start = Math.max(0, Math.min(index - Math.floor(count / 2), choices.length - count));
        let heading: string[] = [];
        if (section) {
          const room = Math.max(0, this.height - count - (options.observe ? 4 : 6));
          heading = this.content(section, tick).slice(0, room);
          if (this.content(section).length > room && room > 1) heading[room - 1] = "… remaining output kept in scrollback when you choose";
          if (room) heading.push(...(options.observe ? [""] : [this.separator(), ""]));
        }
        const prompt = options.prompt.split("\n").map(line => this.line(line));
        // Long prompt descriptions are retained in the completed transcript only
        // through the caller's section; the interactive question stays one line.
        if (options.observe) {
          this.draw([...heading, prompt.join(" "), `Enter ${choices[0].label} · Esc Back · Ctrl-C Exit`]);
          return;
        }
        const lines = [...heading, prompt.join(" "), ...choices.slice(start, start + count).map(c => `${c.id === selected ? "›" : " "} ${c.label}`), "",
          `↑/↓ Move · Enter Select · Esc ${options.back ? "Back" : "Cancel"} · Ctrl-C Exit (${index + 1}/${choices.length})`];
        this.draw(lines, heading.length + 1 + index - start);
      };
      const resize = () => { try { draw(true); } catch (error) { fail(error); } };
      const onKey = (_value: string, key: Key) => {
        try {
          if (key.name === "escape") { if (options.back) finish({ kind: "back" }); else cancel(); return; }
          if (key.ctrl && ["c", "d"].includes(key.name ?? "")) { cancel(); return; }
          if (["return", "enter"].includes(key.name ?? "")) { finish({ kind: "selected", value: choices.find(c => c.id === selected)!.value }); return; }
          const index = choices.findIndex(c => c.id === selected);
          const next = key.name === "up" ? (index + choices.length - 1) % choices.length : key.name === "down" ? (index + 1) % choices.length : key.name === "home" ? 0 : key.name === "end" ? choices.length - 1 : index;
          selected = choices[next].id; draw();
        } catch (error) { fail(error); }
      };
      emitKeypressEvents(input); input.on("keypress", onKey); input.once("end", cancel); input.once("error", fail);
      output.on("resize", resize); process.on("SIGINT", cancel); process.on("SIGTERM", cancel); options.signal?.addEventListener("abort", cancel, { once: true });
      try {
        if (options.signal?.aborted) { cancel(); return; }
        input.setRawMode!(true); input.resume(); output.write("\x1b[?25l"); draw();
        timer = setInterval(() => {
          try { if (options.complete?.()) finish({ kind: "complete" }); else draw(); } catch (error) { fail(error); }
        }, 100);
      } catch (error) { fail(error); }
    });
  }
}
