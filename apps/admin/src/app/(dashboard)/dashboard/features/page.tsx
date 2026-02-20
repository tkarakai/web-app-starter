import { WaitlistFeatureCard } from "@/components/features/waitlist-feature-card";

export default function FeaturesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Features</h1>
        <p className="text-sm text-muted-foreground">
          Manage feature controls for the application.
        </p>
      </div>
      <div className="max-w-2xl space-y-6">
        <WaitlistFeatureCard />
      </div>
    </div>
  );
}
