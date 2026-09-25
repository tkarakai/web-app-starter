import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "@repo/design-system";
import { ConvexError } from "convex/values";

/**
 * Drop-in replacement for Convex's `useMutation` that shows a toast on errors.
 *
 * - Rate limit errors (`ConvexError` with `kind: "RateLimited"`) show a
 *   specific "Too many requests" message with a countdown.
 * - All other errors show a generic "Something went wrong" toast.
 * - Errors are swallowed after the toast is shown (no unhandled rejections).
 */
export function useMutationWithToast(
  ...args: Parameters<typeof useMutation>
): ReturnType<typeof useMutation> {
  const mutation = useMutation(...args);
  const t = useTranslations("errors.convex");

  const wrappedMutation = (...mutationArgs: Parameters<typeof mutation>) => {
    return mutation(...mutationArgs).catch((err: unknown) => {
      if (err instanceof ConvexError) {
        const data = err.data as { kind?: string; retryAt?: number };
        if (data?.kind === "RateLimited") {
          const wait = data.retryAt
            ? Math.ceil((data.retryAt - Date.now()) / 1000)
            : 5;
          toast.error(t("rateLimited", { seconds: Math.max(0, wait) }));
          return;
        }
      }
      toast.error(t("serverError"));
    });
  };

  return wrappedMutation as ReturnType<typeof useMutation>;
}
