import { Separator } from "@repo/design-system";

import { MfaPolicyCard } from "@/components/settings/mfa-policy-card";
import { EmailVerificationPolicyCard } from "@/components/settings/email-verification-policy-card";
import { EmailVerificationTemplateEditor } from "@/components/settings/email-verification-template-editor";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Security policies and application configuration.
        </p>
      </div>
      <div className="max-w-2xl space-y-6">
        <MfaPolicyCard />
        <Separator />
        <EmailVerificationPolicyCard />
        <EmailVerificationTemplateEditor />
      </div>
    </div>
  );
}
