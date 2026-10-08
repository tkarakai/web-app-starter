/** Explicit opt-in to native definitions, without impersonating ctx.auth or running wrappers twice. */
import { v, type PropertyValidators, type ValidatorJSON } from "convex/values";
import { validate } from "convex-helpers/validators";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type NativeKind = "query" | "mutation";
interface NativeDefinition {
  args: PropertyValidators;
  handler: (ctx: unknown, args: unknown) => unknown;
  kind: NativeKind;
}
const definitions = new WeakMap<object, NativeDefinition>();
export function rememberNative<T extends object>(registered: T, definition: unknown, kind: NativeKind): T {
  const value = definition as { args?: PropertyValidators; handler?: unknown };
  if (value.args && typeof value.handler === "function") {
    definitions.set(registered, { args: value.args, handler: value.handler as NativeDefinition["handler"], kind });
  }
  return registered;
}
/** Preserve the builder's public inference; only selected registry entries are remotely callable. */
export function captureNativeBuilder<T extends (definition: never) => object>(builder: T, kind: NativeKind): T {
  return ((definition: unknown) => rememberNative((builder as unknown as (definition: unknown) => object)(definition), definition, kind)) as unknown as T;
}
export function nativeDefinition(registered: object) {
  const definition = definitions.get(registered);
  if (!definition) throw new Error("NATIVE_CAPABILITY_NOT_REGISTERED");
  return definition;
}
export async function invokeNative(registered: object, ctx: QueryCtx | MutationCtx, auth: unknown, input: unknown) {
  const definition = nativeDefinition(registered);
  validate(v.object(definition.args), input, { throw: true, db: ctx.db });
  return await definition.handler({ ...ctx, ...(auth as Record<string, unknown>) }, input);
}
/** JSON Schema is documentation; Convex validators above remain the execution authority. */
export function validatorSchema(validator: ValidatorJSON): Record<string, unknown> {
  switch (validator.type) {
    case "string": case "boolean": case "number": case "null": return { type: validator.type };
    case "id": return { type: "string", description: `Opaque ${validator.tableName} ID` };
    case "literal": return { const: validator.value };
    case "array": return { type: "array", items: validatorSchema(validator.value) };
    case "union": return { anyOf: validator.value.map(validatorSchema) };
    case "object": return { type: "object", properties: Object.fromEntries(Object.entries(validator.value).map(([name, field]) => [name, validatorSchema(field.fieldType)])), required: Object.entries(validator.value).filter(([, field]) => !field.optional).map(([name]) => name), additionalProperties: false };
    case "record": return { type: "object", additionalProperties: validatorSchema(validator.values.fieldType) };
    case "any": return {};
    default: throw new Error("CAPABILITY_REQUIRES_NON_JSON_INPUT");
  }
}
export function nativeSchema(registered: object) { return validatorSchema((v.object(nativeDefinition(registered).args) as unknown as { json: ValidatorJSON }).json); }
