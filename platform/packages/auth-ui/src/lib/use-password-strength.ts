"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useThrottledPasswordCheck } from "@web-app-starter/design-system/password-strength";
import { api } from "@repo/backend";

type StrengthContext = Omit<FunctionArgs<typeof api.platform.passwordStrength.evaluate>, "password">;

/** One query/throttle lifecycle for every password-creation form. */
export function usePasswordStrength(password: string, context: StrengthContext | "skip"): {
  result: FunctionReturnType<typeof api.platform.passwordStrength.evaluate> | undefined;
  valid: boolean;
} {
  const [evaluatedPassword, notifyResolved] = useThrottledPasswordCheck(password);
  const result = useQuery(
    api.platform.passwordStrength.evaluate,
    evaluatedPassword && context !== "skip" ? { ...context, password: evaluatedPassword } : "skip",
  );
  useEffect(() => {
    if (result !== undefined || context === "skip") notifyResolved();
  }, [result, context, notifyResolved]);

  // Never present an older password's result as current or enable submission
  // while the latest keystrokes are still waiting in the throttle queue.
  const currentResult = password === evaluatedPassword && context !== "skip" ? result : undefined;
  return { result: currentResult, valid: !!password && (currentResult?.valid ?? false) };
}
