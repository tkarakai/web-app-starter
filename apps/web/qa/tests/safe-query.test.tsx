import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useSafeQuery } from "../../src/hooks/use-safe-query";

// Exercise the real Convex React subscription code, not a mocked useQueries.
describe("safe Convex subscriptions", () => {
  it("stays stable across equivalent renders, contains live denial and rebinds exact arguments", () => {
    const listeners = new Set<() => void>();
    const values: Record<string, unknown> = { "org-a": ["private-a"], "org-b": ["private-b"] };
    const subscribed = vi.fn(); const unsubscribed = vi.fn();
    const client = { watchQuery: (_reference: unknown, args: { organizationId: string }) => ({
      localQueryResult: () => { const value = values[args.organizationId]; if (value instanceof Error) throw value; return value; },
      onUpdate: (notify: () => void) => { subscribed(args); listeners.add(notify); return () => { unsubscribed(args); listeners.delete(notify); }; },
    }) } as unknown as ConvexReactClient;
    const wrapper = ({ children }: { children: ReactNode }) => <ConvexProvider client={client}>{children}</ConvexProvider>;
    const { result, rerender, unmount } = renderHook(({ id }: { id: string | null }) => useSafeQuery(makeFunctionReference<"query", { organizationId: string }, string[]>("tenantProjects:list"), id ? { organizationId: id } : "skip"), { wrapper, initialProps: { id: "org-a" as string | null } });
    expect(result.current.data).toEqual(["private-a"]);
    for (let i = 0; i < 5; i++) rerender({ id: "org-a" });
    expect(subscribed).toHaveBeenCalledTimes(1);
    act(() => { values["org-a"] = new Error("ORGANIZATION_UNAVAILABLE"); for (const notify of listeners) notify(); });
    expect(result.current.data).toBeUndefined(); expect(result.current.error?.message).toBe("ORGANIZATION_UNAVAILABLE");
    rerender({ id: "org-b" });
    expect(result.current.data).toEqual(["private-b"]); expect(result.current.error).toBeNull();
    expect(subscribed).toHaveBeenLastCalledWith({ organizationId: "org-b" });
    expect(unsubscribed).toHaveBeenCalledWith({ organizationId: "org-a" });
    rerender({ id: null }); expect(result.current.data).toBeUndefined(); expect(listeners.size).toBe(0);
    unmount(); expect(listeners.size).toBe(0);
  });
});
