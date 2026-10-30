"use client";

import { useQueries } from "convex/react";
import { useRef } from "react";
import { convexToJson } from "convex/values";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";

/** Permission can disappear while subscribed; represent denial without throwing through the app. */
export function useSafeQuery<Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query> | "skip") {
  // useQueries requires stable request identity (unlike useQuery, it does not
  // memoize arguments). Keep equivalent renders on the same subscription.
  const key = JSON.stringify([getFunctionName(query), args === "skip" ? "skip" : convexToJson(args)]);
  const request = useRef<{ key: string; queries: Parameters<typeof useQueries>[0] } | null>(null);
  if (request.current?.key !== key) request.current = { key, queries: args === "skip" ? {} : { result: { query, args } } };
  const result = useQueries(request.current.queries).result;
  return {
    data: (result instanceof Error ? undefined : result) as FunctionReturnType<Query> | undefined,
    error: result instanceof Error ? result : null,
  };
}
