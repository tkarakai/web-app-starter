import { MfaPolicyCard } from "@/components/settings/mfa-policy-card";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Security policies and application configuration.
        </p>
      </div>
      <div className="max-w-2xl">
        <MfaPolicyCard />
      </div>
    </div>
  );
}
