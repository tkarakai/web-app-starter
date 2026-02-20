import { Separator } from "@repo/design-system";

import { EmailVerificationPolicyCard } from "@/components/settings/email-verification-policy-card";
import { MfaPolicyCard } from "@/components/settings/mfa-policy-card";

export default function SecurityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-muted-foreground">
          Security policies and authentication requirements.
        </p>
      </div>
      <div className="max-w-2xl space-y-6">
        <EmailVerificationPolicyCard />
        <Separator />
        <MfaPolicyCard />
      </div>
    </div>
  );
}
