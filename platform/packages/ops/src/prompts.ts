import { PaperRoll, PaperRollError } from "@repo/paper-roll";
import { OpsError, redact } from "./errors";

export interface SelectOptions {
  back?: boolean; summary?: () => string[]; complete?: () => boolean;
  title?: string; pending?: () => boolean; labels?: () => string[];
  onHighlight?: (index: number) => void;
  observe?: boolean;
}
export type Select = (label: string, choices: string[], initial?: number, options?: SelectOptions) => Promise<number>;
export const opsRoll = new PaperRoll({ sanitize: redact });
export function promptError(error: unknown): never {
  if (error instanceof PaperRollError) throw new OpsError(error.code, error.message,
    error.code === "INTERRUPTED" ? "Remote work continues. Run ops to resume monitoring." : "Run ops in an interactive terminal without --json.", error.code === "INTERRUPTED" ? 130 : 2);
  throw error;
}
export const terminalSelect: Select = async (label, choices, initial = 0, options = {}) => {
  try {
    const result = await opsRoll.choose({
      prompt: options.observe ? "Watching automatically. No keypress needed." : options.summary ? "What would you like to do next?" : label,
      observe: options.observe,
      choices: () => (options.labels?.() ?? choices).map((choice, index) => ({ id: String(index), label: choice, value: index })),
      initial: String(initial), back: options.back, complete: options.complete,
      onHighlight: choice => options.onHighlight?.(choice.value),
      section: options.summary ? () => ({ title: options.title ?? label, lines: options.summary!(), pending: options.pending?.() }) : undefined,
    });
    return result.kind === "back" ? -1 : result.kind === "complete" ? -2 : result.value;
  } catch (error) { return promptError(error); }
};
