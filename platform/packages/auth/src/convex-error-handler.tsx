"use client";

import { errorCode } from "@web-app-starter/agentic/errors";

import { useEffect, useRef, useCallback } from "react";
import { ConvexError } from "convex/values";

export type ConvexErrorInfo = {
  /** Machine-readable error code for i18n lookup. */
  code: string;
  /** Default English message (used as fallback when no translation exists). */
  message: string;
  /** Optional interpolation params (e.g. { seconds: 5 } for rate limits). */
  params?: Record<string, string | number>;
};

/**
 * Extract structured error info from a Convex error.
 *
 * Convex SDK wraps server errors in this format:
 *   [CONVEX M(module:function)] errorMessage
 *     Called by client
 *
 * ConvexError instances carry structured data in `.data`.
 */
export function extractErrorInfo(error: unknown): ConvexErrorInfo | null {
  const code = errorCode(error);
  if (code === "RATE_LIMITED") {
    const data = (error as { data?: Record<string, unknown> }).data;
    const seconds = typeof data?.retryAfter === "number" ? Math.max(1, Math.ceil(data.retryAfter / 1000))
      : typeof data?.retryAt === "number" ? Math.max(1, Math.ceil((data.retryAt - Date.now()) / 1000)) : 5;
    return { code, message: `Too many requests. Please wait ${seconds} seconds.`, params: { seconds } };
  }
  if (code) return { code, message: code };
  if (error instanceof ConvexError) {
    const data = error.data;
    const msg =
      typeof data === "string"
        ? data
        : data && typeof data === "object" && "message" in data
          ? String((data as Record<string, unknown>).message)
          : error.message;
    return { code: "SERVER_ERROR", message: msg };
  }

  if (error instanceof Error) {
    // Convex server function errors: [CONVEX M(path)] errorMessage\n  Called by client
    // Parse the envelope in linear passes. Combining an unbounded whitespace
    // match with a message capture can backtrack quadratically on blank input.
    const prefix = /^\[CONVEX [A-Z]\(/.exec(error.message);
    if (prefix) {
      const close = error.message.indexOf(")", prefix[0].length);
      if (close > prefix[0].length && error.message[close + 1] === "]") {
        const body = error.message.slice(close + 2).trimStart();
        const newline = body.indexOf("\n");
        const rawMessage = newline < 0 ? body : body.slice(0, newline);
        if (rawMessage) return { code: rawMessage, message: rawMessage };
      }
    }

    // Network / infrastructure errors (Convex is down, no connectivity)
    if (
      error instanceof TypeError ||
      error.message.includes("fetch") ||
      error.message.includes("network") ||
      error.message.includes("Failed to") ||
      /^[0-9]{3}\b/.test(error.message) ||
      error.message.startsWith("<!") ||
      error.message.startsWith("<html")
    ) {
      return {
        code: "CONNECTION_LOST",
        message:
          "Unable to connect to the server. Please check your connection.",
      };
    }
  }

  return null;
}

type ConvexErrorHandlerProps = {
  /** Called when an unhandled Convex error is detected. */
  onError: (info: ConvexErrorInfo) => void;
  /** Deduplication window in milliseconds. Default: 2000. */
  dedupeWindowMs?: number;
};

/**
 * Global handler for unhandled Convex server call errors.
 *
 * Listens for `unhandledrejection` events, identifies Convex and
 * network errors, deduplicates within a time window, and calls
 * `onError` with structured error info. Renders nothing. Mount once
 * near the app root.
 */
export function ConvexErrorHandler({
  onError,
  dedupeWindowMs = 2000,
}: ConvexErrorHandlerProps) {
  const recentRef = useRef<Map<string, number>>(new Map());

  const handleRejection = useCallback(
    (event: globalThis.PromiseRejectionEvent) => {
      const info = extractErrorInfo(event.reason);
      if (!info) return;

      event.preventDefault();

      const now = Date.now();
      const recent = recentRef.current;
      const dedupeKey = info.code;
      const lastShown = recent.get(dedupeKey);
      if (lastShown && now - lastShown < dedupeWindowMs) return;

      recent.set(dedupeKey, now);

      // Clean stale entries
      for (const [key, time] of recent) {
        if (now - time > dedupeWindowMs) recent.delete(key);
      }

      onError(info);
    },
    [onError, dedupeWindowMs],
  );

  useEffect(() => {
    window.addEventListener("unhandledrejection", handleRejection);
    return () =>
      window.removeEventListener("unhandledrejection", handleRejection);
  }, [handleRejection]);

  return null;
}
