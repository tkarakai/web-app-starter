"use client";

import * as React from "react";
import { Toaster } from "sonner";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@repo/backend";
import { useSignOut } from "@web-app-starter/auth-ui";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@web-app-starter/design-system";
import { TenancySetup } from "./tenancy-setup";

type Status = FunctionReturnType<typeof api.platform.tenancy.status> | undefined;
const TenancyContext = React.createContext<{ status: Status } | null>(null);
export function useTenancyStatus() {
  const context = React.useContext(TenancyContext);
  const status = useQuery(api.platform.tenancy.status, context ? "skip" : {});
  return context ? context.status : status;
}

/** Keep setup subscribed in the persistent shell; never mount normal pages before bootstrap. */
export function TenancyRequired({ children }: { children: React.ReactNode }) {
  const liveStatus = useQuery(api.platform.tenancy.status);
  // Tenancy is immutable once configured. Session rotation during 2FA temporarily clears
  // authenticated subscriptions; it must not unmount the page holding one-time backup codes.
  // The parent AuthGuard remains responsible for session invalidation and authorization.
  const [configuredStatus, setConfiguredStatus] = React.useState<Status>(undefined);
  React.useEffect(() => {
    if (liveStatus?.mode) setConfiguredStatus(liveStatus);
  }, [liveStatus]);
  const status = liveStatus ?? configuredStatus;
  const pathname = usePathname();
  const signOut = useSignOut("/sign-in");
  const security = ["/settings", "/dashboard/settings", "/configure/setup-2fa", "/dashboard/setup-2fa"].includes(pathname);
  const repairPlans = pathname === "/manage/plans" && status?.eligibility?.plans.ready === false;
  const configured = !!status?.mode;

  return <TenancyContext.Provider value={{ status }}>
    {configured ? children : <main className="min-h-dvh bg-muted/30">
      {status && (security || repairPlans) ? <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Button asChild variant="outline"><Link href="/configure/tenancy">Back to setup</Link></Button>
        {children}
      </div> : <Dialog open>
        <DialogContent showCloseButton={false} className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto" onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}>
          <DialogHeader>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">One-time setup</p>
            <DialogTitle className="text-2xl">Who is your app for?</DialogTitle>
            <DialogDescription>Choose how people use your app. Finish setup to open the admin dashboard and enable sign-ups.</DialogDescription>
          </DialogHeader>
          {status === undefined ? <div role="status" className="space-y-3 py-8">
            <p className="text-sm text-muted-foreground">Checking your installation…</p>
            <div className="h-20 animate-pulse rounded-lg bg-muted" />
            <div className="h-20 animate-pulse rounded-lg bg-muted" />
          </div> : status === null ? <p role="alert">Your session could not be verified. Sign out and sign in again to continue.</p> : <TenancySetup />}
          <div className="flex items-center justify-between border-t pt-4">
            <Button asChild variant="link" className="px-0"><Link href="/settings?tab=security">Account security</Link></Button>
            <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </DialogContent>
      </Dialog>}
      <Toaster position="bottom-right" />
    </main>}
  </TenancyContext.Provider>;
}
