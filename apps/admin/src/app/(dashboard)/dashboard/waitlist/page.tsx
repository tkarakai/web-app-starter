import { WaitlistPageTabs } from "@/components/waitlist/waitlist-page-tabs";
import { WaitlistSettings } from "@/components/waitlist/waitlist-settings";

export default function WaitlistPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Waitlist</h1>
          <p className="text-sm text-muted-foreground">
            Manage waitlist entries, send invitations, and customize your
            invitation email.
          </p>
        </div>
        <WaitlistSettings />
      </div>
      <WaitlistPageTabs />
    </div>
  );
}
