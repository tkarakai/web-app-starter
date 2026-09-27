import { componentsGeneric, mutationGeneric, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import { platformSchema, platformModules } from "@web-app-starter/convex-platform/test";
import type { GenericMutationCtx, DataModelFromSchemaDefinition } from "convex/server";
import type { createTestEnv } from "../convex/test.modules";

type PlatformCtx = GenericMutationCtx<DataModelFromSchemaDefinition<typeof platformSchema>>;

/** Test-only fixture transactions in the component database. Never deployed. */
export function platformRunner(t: ReturnType<typeof createTestEnv>) {
  const callbacks = new Map<string, (ctx: PlatformCtx) => Promise<unknown>>();
  let sequence = 0;
  t.registerComponent("platform", platformSchema, {
    ...platformModules,
    "./component/__fixture.ts": async () => ({
      run: mutationGeneric({
        args: { key: v.string() },
        handler: async (ctx, { key }) => {
          const callback = callbacks.get(key);
          if (!callback) throw new Error("MISSING_TEST_FIXTURE");
          return callback(ctx);
        },
      }),
    }),
  });
  const run = componentsGeneric().platform.__fixture.run as FunctionReference<"mutation", "internal", { key: string }, unknown>;
  return async <T>(callback: (ctx: PlatformCtx) => Promise<T>): Promise<T> => {
    const key = String(sequence++);
    callbacks.set(key, callback);
    try {
      return await t.mutation(run, { key }) as T;
    } finally {
      callbacks.delete(key);
    }
  };
}
