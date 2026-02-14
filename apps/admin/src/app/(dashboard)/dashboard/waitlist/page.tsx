import { WaitlistSettings } from "@/components/waitlist/waitlist-settings";
import { WaitlistDataTable } from "@/components/waitlist/waitlist-data-table";

export default function WaitlistPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waitlist</h1>
        <p className="text-sm text-muted-foreground">
          Manage waitlist entries, send invitations, and configure waitlist mode.
        </p>
      </div>
      <WaitlistSettings />
      <WaitlistDataTable />
    </div>
  );
}
