/** A separate, bounded channel: never inspect the child's stdout/stderr for progress. */
import { writeSync } from "node:fs";
import { activities, validateReport, type SafeAttempt } from "./secret-safe-report.ts";

export const progressLimits = { frameBytes: 65536, streamBytes: 16 * 1024 * 1024, events: 20000, tests: 10000, retries: 100 } as const;
export interface ProgressTest { number: number; file: string; line: number; column: number }
export type ProgressEvent = { kind: "suite"; tests: number } |
  { kind: "start"; test: ProgressTest; retry: number } |
  { kind: "end"; test: ProgressTest; attempt: SafeAttempt };
const invalid = () => new Error("Invalid safe progress");
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) throw invalid();
  return result;
}
function integer(value: unknown, max: number, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw invalid();
  return value;
}
function location(value: unknown): ProgressTest {
  const test = object(value, ["number", "file", "line", "column"]);
  integer(test.number, progressLimits.tests, 1); integer(test.line, 10000000); integer(test.column, 10000000);
  if (typeof test.file !== "string" || test.file.length > 240) throw invalid();
  // Reuse the authoritative source-path validator; never weaken its alphabet.
  const normalized = validateReport({ version: 1, status: "failed", tests: [{ ...test, outcome: "unexpected", attempts: [] }], globalErrors: [], suppressedOutputBytes: 0 }).tests[0];
  return { number: normalized.number, file: normalized.file, line: normalized.line, column: normalized.column };
}
function attempt(value: unknown, test: ProgressTest): SafeAttempt {
  const a = object(value, ["status", "expectedStatus", "retry", "durationMs", "diagnostics", "activities", "failures"]);
  integer(a.retry, progressLimits.retries); integer(a.durationMs, 1000000000);
  if (!Array.isArray(a.diagnostics) || a.diagnostics.length > 64 || !Array.isArray(a.failures) || a.failures.length > 128) throw invalid();
  if (!a.activities || typeof a.activities !== "object" || Array.isArray(a.activities) || Object.keys(a.activities).length > activities.length) throw invalid();
  for (const count of Object.values(a.activities)) integer(count, 10000000);
  for (const entry of a.failures) {
    const failure = object(entry, ["file", "line", "column", "category"]);
    if (typeof failure.file !== "string" || failure.file.length > 240) throw invalid();
    integer(failure.line, 10000000); integer(failure.column, 10000000);
  }
  return validateReport({ version: 1, status: "failed", tests: [{ ...test, outcome: "unexpected", attempts: [a] }], globalErrors: [], suppressedOutputBytes: 0 }).tests[0].attempts[0];
}
export function validateProgress(value: unknown): ProgressEvent {
  if (!value || typeof value !== "object" || !("kind" in value)) throw invalid();
  if (value.kind === "suite") { const event = object(value, ["kind", "tests"]); return { kind: "suite", tests: integer(event.tests, progressLimits.tests) }; }
  if (value.kind === "start") {
    const event = object(value, ["kind", "test", "retry"]);
    return { kind: "start", test: location(event.test), retry: integer(event.retry, progressLimits.retries) };
  }
  if (value.kind === "end") {
    const event = object(value, ["kind", "test", "attempt"]); const test = location(event.test);
    return { kind: "end", test, attempt: attempt(event.attempt, test) };
  }
  throw invalid();
}
export class ProgressWriter {
  private sequence = 0;
  private bytes = 0;
  private run: string;
  private sink: (bytes: Buffer) => number;
  constructor(run: string, sink = (bytes: Buffer) => writeSync(3, bytes)) { this.run = run; this.sink = sink; }
  send(input: ProgressEvent) {
    const event = validateProgress(input);
    const frame = Buffer.from(JSON.stringify({ version: 1, run: this.run, sequence: ++this.sequence, event }) + "\n");
    this.bytes += frame.length;
    if (frame.length > progressLimits.frameBytes || this.bytes > progressLimits.streamBytes || this.sequence > progressLimits.events || this.sink(frame) !== frame.length) throw invalid();
  }
}
export class ProgressChannel {
  private buffer = Buffer.alloc(0);
  private bytes = 0;
  private events: ProgressEvent[] = [];
  private total?: number;
  private attempts = new Map<number, { test: ProgressTest; retry: number; running: boolean }>();
  private state: "collecting" | "closed" | "rejected" = "collecting";
  private run: string;
  private changed: (event?: ProgressEvent) => void;
  constructor(run: string, changed: (event?: ProgressEvent) => void) { this.run = run; this.changed = changed; }
  get rejected() { return this.state === "rejected"; }
  private reject() { if (this.rejected) return; this.state = "rejected"; this.buffer = Buffer.alloc(0); this.changed(); }
  feed(chunk: Buffer) {
    if (this.state !== "collecting") return;
    this.bytes += chunk.length;
    if (this.bytes > progressLimits.streamBytes) { this.reject(); return; }
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset); const end = newline < 0 ? chunk.length : newline;
      if (this.buffer.length + end - offset + 1 > progressLimits.frameBytes) { this.reject(); return; }
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, end)]);
      offset = end + 1;
      if (newline < 0) return;
      try {
        const parsed: unknown = JSON.parse(this.buffer.toString("utf8"));
        if (!this.buffer.equals(Buffer.from(JSON.stringify(parsed)))) throw invalid();
        const envelope = object(parsed, ["version", "run", "sequence", "event"]);
        this.buffer = Buffer.alloc(0);
        if (envelope.version !== 1 || envelope.run !== this.run || envelope.sequence !== this.events.length + 1 || this.events.length >= progressLimits.events) throw invalid();
        const event = validateProgress(envelope.event);
        if (event.kind === "suite") {
          if (this.total !== undefined || this.events.length !== 0) throw invalid();
          this.total = event.tests;
        } else {
          if (this.total === undefined || event.test.number > this.total) throw invalid();
          const prior = this.attempts.get(event.test.number); const retry = event.kind === "start" ? event.retry : event.attempt.retry;
          if (prior && JSON.stringify(prior.test) !== JSON.stringify(event.test)) throw invalid();
          if (event.kind === "start") {
            if (prior ? prior.running || retry !== prior.retry + 1 : retry !== 0) throw invalid();
            this.attempts.set(event.test.number, { test: event.test, retry, running: true });
          } else {
            if (!prior?.running || retry !== prior.retry) throw invalid();
            prior.running = false;
          }
        }
        this.events.push(event); this.changed(event);
      } catch { this.reject(); return; }
    }
  }
  finish() {
    if (this.state !== "collecting") return;
    if (this.buffer.length || this.total === undefined) { this.reject(); return; }
    this.state = "closed"; this.changed();
  }
  snapshot() {
    // Progress is always incomplete, including after EOF. Only report.json has a suite verdict.
    return { version: 1, complete: false, channel: this.state, events: this.events,
      inFlight: [...this.attempts.values()].filter(a => a.running).map(a => ({ test: a.test, retry: a.retry })) };
  }
}
export function progressText(event?: ProgressEvent) {
  return event ? `Secret-safe progress (incomplete): ${JSON.stringify(event)}\n` : "Secret-safe progress channel closed or rejected; final report remains authoritative.\n";
}
