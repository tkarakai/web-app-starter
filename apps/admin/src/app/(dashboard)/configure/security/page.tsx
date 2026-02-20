import { KeyRound, Link2 } from "lucide-react";

import { NotImplementedCard } from "@/components/configure/not-implemented-card";
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
        <MfaPolicyCard />
        <NotImplementedCard
          icon={KeyRound}
          title="PassKey"
          description="Allow users to sign in using a passkey."
        />
        <NotImplementedCard
          icon={Link2}
          title="Magic Link"
          description="Allow users to sign in via a magic link sent to their email."
        />
      </div>
    </div>
  );
}
