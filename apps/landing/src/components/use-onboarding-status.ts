"use client";

import { useEffect, useState } from "react";

type Status = "loading" | "unreachable" | "waitlist" | "signup" | "closed";

/** Unknown modes fail closed, including a future mode with legacy booleans set. */
function parseStatus(value: unknown): Status {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "closed";
  const data = value as Record<string, unknown>;
  if (data.onboardingType !== undefined) {
    if (["publicWaitlist", "waitlist"].includes(String(data.onboardingType))) return "waitlist";
    if (["publicSignup", "signup"].includes(String(data.onboardingType))) return "signup";
    return "closed";
  }
  if (data.waitlistEnabled === true || data.enabled === true) return "waitlist";
  return data.signupEnabled === true ? "signup" : "closed";
}

/** Read public mode in the browser; retry outages and refresh when returning to the tab. */
export function useOnboardingStatus(): Status {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
    if (!siteUrl) throw new Error("Missing required environment variable: NEXT_PUBLIC_CONVEX_SITE_URL");
    let generation = 0;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: InstanceType<typeof window.AbortController> | undefined;

    const cancel = () => {
      generation++;
      clearTimeout(timer);
      controller?.abort();
    };
    const load = async () => {
      cancel();
      const current = generation;
      controller = new window.AbortController();
      const request = controller;
      const timeout = setTimeout(() => request.abort(), 8_000);
      try {
        const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/waitlist/status`, {
          cache: "no-store", signal: request.signal,
        });
        if (!response.ok) throw new Error("Onboarding unavailable");
        const next = parseStatus(await response.json());
        if (current !== generation) return;
        attempts = 0;
        setStatus(next);
      } catch {
        if (current !== generation) return;
        setStatus("unreachable");
        if (attempts < 10 && document.visibilityState !== "hidden") {
          timer = setTimeout(() => { void load(); }, Math.min(5_000 * 2 ** attempts++, 60_000));
        }
      } finally {
        clearTimeout(timeout);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") cancel();
      else { attempts = 0; void load(); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void load();
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return status;
}
