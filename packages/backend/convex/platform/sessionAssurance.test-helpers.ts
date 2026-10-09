import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { registerPlatform } from "@web-app-starter/convex-platform/test";
import schema from "../schema";
import { authedMutation, authedQuery } from "./functions";

// The extra dot keeps this helper out of Convex deployment. These endpoints exist
// only in convex-test's module map and exercise the real session-policy wrappers.
const fixturePath = "platform/sessionAssuranceFixture";
export const assuranceApi = {
  read: makeFunctionReference<"query", Record<string, never>, string | null>(`${fixturePath}:read`),
  write: makeFunctionReference<"mutation", Record<string, never>, string>(`${fixturePath}:write`),
};

export function createSessionAssuranceTestEnv(modules: Record<string, () => Promise<unknown>>) {
  const t = convexTest(schema, {
    ...modules,
    [`./${fixturePath}.ts`]: async () => ({
      read: authedQuery({ args: {}, handler: ctx => ctx.ownerId }),
      write: authedMutation({ args: {}, handler: ctx => ctx.ownerId }),
    }),
  });
  registerPlatform(t);
  return t;
}
