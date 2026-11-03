import { TenancySetup } from "@/components/tenancy/tenancy-setup";

export default function TenancyPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tenancy</h1>
        <p className="text-sm text-muted-foreground">
          Whether the product serves individuals or organizations, and how plans are paid for.
        </p>
      </div>
      <TenancySetup />
    </div>
  );
}
