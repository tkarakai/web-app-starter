import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import {
  fetchAction,
  fetchMutation,
  fetchQuery,
  preloadQuery,
  type NextjsOptions,
} from "convex/nextjs";
import type { Preloaded } from "convex/react";
import type {
  ArgsAndOptions,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";

/**
 * Next.js server helpers that proxy auth requests to the Convex deployment.
 *
 * `CONVEX_URL` and `CONVEX_SITE_URL` are read unprefixed, at request time, so
 * the build carries no environment identity and one artifact can be promoted
 * between environments. See platform/docs/deployment-architecture.md
 */
const {
  handler,
  getToken,
  isAuthenticated,
} = convexBetterAuthNextJs({
  convexUrl: process.env.CONVEX_URL!,
  convexSiteUrl: process.env.CONVEX_SITE_URL!,
});

export { handler, getToken, isAuthenticated };

function convexUrl(): string {
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error("Missing required environment variable: CONVEX_URL");
  }
  return url;
}

/**
 * Build the options for a `convex/nextjs` call: the caller's own options, plus
 * the auth token and an explicit deployment URL.
 *
 * The explicit URL is the point of this module. `convexBetterAuthNextJs` accepts
 * a `convexUrl` option but only uses it when fetching tokens — its own
 * `fetchAuthQuery` / `preloadAuthQuery` / `fetchAuthMutation` / `fetchAuthAction`
 * call `convex/nextjs` with `{ token }` alone (see `getArgsAndOptions` in
 * `@convex-dev/better-auth/dist/nextjs/index.js`). `NextjsOptions.url` then
 * defaults to `process.env.NEXT_PUBLIC_CONVEX_URL`, which Next.js inlines at
 * build time — pinning the artifact to whichever environment built it, and
 * throwing at runtime when that variable is absent.
 *
 * Passing `url` ourselves is what keeps the artifact environment-agnostic. These
 * four wrappers exist only to supply it; drop them if the adapter starts
 * forwarding `convexUrl` to its query helpers.
 */
async function authOptions(options?: NextjsOptions): Promise<NextjsOptions> {
  return { ...options, token: await getToken(), url: convexUrl() };
}

export async function preloadAuthQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: ArgsAndOptions<Query, NextjsOptions>
): Promise<Preloaded<Query>> {
  const [queryArgs, options] = args;
  return preloadQuery(query, queryArgs, await authOptions(options));
}

export async function fetchAuthQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: ArgsAndOptions<Query, NextjsOptions>
): Promise<FunctionReturnType<Query>> {
  const [queryArgs, options] = args;
  return fetchQuery(query, queryArgs, await authOptions(options));
}

export async function fetchAuthMutation<
  Mutation extends FunctionReference<"mutation">,
>(
  mutation: Mutation,
  ...args: ArgsAndOptions<Mutation, NextjsOptions>
): Promise<FunctionReturnType<Mutation>> {
  const [mutationArgs, options] = args;
  return fetchMutation(mutation, mutationArgs, await authOptions(options));
}

export async function fetchAuthAction<Action extends FunctionReference<"action">>(
  action: Action,
  ...args: ArgsAndOptions<Action, NextjsOptions>
): Promise<FunctionReturnType<Action>> {
  const [actionArgs, options] = args;
  return fetchAction(action, actionArgs, await authOptions(options));
}
