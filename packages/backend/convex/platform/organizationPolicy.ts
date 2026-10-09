import type { GenericCtx } from "@convex-dev/better-auth";
import type { DataModel } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { components } from "../_generated/api";
import type { PasskeyPolicy } from "./securityPolicies";

/** One live policy for operators and org-admins. Legacy storage is read only until preserving initialization. */
export async function readAdminPasskeyPolicy(ctx: Pick<GenericCtx<DataModel>, "runQuery">): Promise<PasskeyPolicy> {
  const canonical = await ctx.runQuery(components.betterAuth.organizationSecurity.policy, {});
  if (canonical !== null) return canonical;
  const legacy = await ctx.runQuery(components.platform.appSettings.getRaw, { key: "adminPasskeyPolicy" });
  if (!legacy) return "optional";
  let value: unknown = legacy.value;
  try { value = JSON.parse(legacy.value); } catch { /* Preserve the raw policy value. */ }
  return value === "disabled" || value === "optional" ? value : "required";
}

export async function initializeAdminPasskeyPolicy(ctx: Pick<MutationCtx, "runQuery" | "runMutation">) {
  const value = await readAdminPasskeyPolicy(ctx);
  return ctx.runMutation(components.betterAuth.organizationSecurity.initializePolicy, { value });
}
