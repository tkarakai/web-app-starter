"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@web-app-starter/design-system";
import {
  ConvexErrorHandler,
  type ConvexErrorInfo,
} from "@web-app-starter/auth/error-handler";

/** Platform Convex error codes and their keys under the platform's "errors.convex" namespace. */
export const PLATFORM_ERROR_KEYS: Readonly<Record<string, string>> = {
  RATE_LIMITED: "errors.convex.rateLimited",
  NOT_AUTHENTICATED: "errors.convex.notAuthenticated",
  CONNECTION_LOST: "errors.convex.connectionLost",
  SERVER_ERROR: "errors.convex.serverError",
};

/**
 * The full message key for a Convex error code: the app's own mapping first, then the
 * platform's, else undefined.
 */
export function errorMessageKey(
  code: string,
  appErrorKeys: Readonly<Record<string, string>> = {},
): string | undefined {
  return appErrorKeys[code] ?? PLATFORM_ERROR_KEYS[code];
}

interface ConvexErrorToastProps {
  /**
   * The app's error codes, mapped to full message keys in the app's own namespaces,
   * e.g. `{ PROJECT_NOT_FOUND: "sampleErrors.projectNotFound" }`.
   */
  appErrorKeys?: Readonly<Record<string, string>>;
}

/** Shows a translated toast for every Convex error the client reports. */
export function ConvexErrorToast({ appErrorKeys }: ConvexErrorToastProps) {
  const t = useTranslations();

  const handleError = useCallback(
    (info: ConvexErrorInfo) => {
      const key = errorMessageKey(info.code, appErrorKeys);
      toast.error(key ? t(key, info.params) : t("errors.convex.serverError"));
    },
    [t, appErrorKeys],
  );

  return <ConvexErrorHandler onError={handleError} />;
}
