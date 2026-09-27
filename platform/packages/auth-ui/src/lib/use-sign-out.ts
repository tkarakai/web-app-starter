"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@web-app-starter/auth/client";

/** A sign-out handler that ends the Better Auth session, then navigates to `redirectTo`. */
export function useSignOut(redirectTo = "/"): () => void {
  const router = useRouter();
  return useCallback(() => {
    void authClient.signOut({
      fetchOptions: {
        onSuccess: () => router.push(redirectTo),
      },
    });
  }, [router, redirectTo]);
}
