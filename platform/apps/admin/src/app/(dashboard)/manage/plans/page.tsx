import { PlansManager } from "@/components/tenancy/plans-manager";

export default function PlansPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="text-sm text-muted-foreground">
          The plans organizations can be on. Prices are monthly, in US dollars.
        </p>
      </div>
      <PlansManager />
    </div>
  );
}
