import { ConvexError, type Value } from "convex/values";

/** A public refusal whose code and explicit details survive Convex production redaction. */
export function refuse(code: string, details: Record<string, Value> = {}): never {
  throw new ConvexError({ ...details, code });
}
