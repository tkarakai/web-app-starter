import { WaitlistDataTable } from "@/components/waitlist/waitlist-data-table";
import { OnboardingModeNote } from "@/components/onboarding/onboarding-mode-note";

export default function OnboardingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Onboarding Queue</h1>
        <p className="text-sm text-muted-foreground">
          Manage waitlist entries and invitations.
        </p>
        <OnboardingModeNote />
      </div>
      <WaitlistDataTable />
    </div>
  );
}
