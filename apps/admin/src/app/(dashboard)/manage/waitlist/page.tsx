import { WaitlistDataTable } from "@/components/waitlist/waitlist-data-table";

export default function WaitlistPage() {
  return (
    <div className="space-y-6">
      <div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Waitlist</h1>
          <p className="text-sm text-muted-foreground">
            Manage waitlist entries and send invitations.
          </p>
        </div>
      </div>
      <WaitlistDataTable />
    </div>
  );
}
