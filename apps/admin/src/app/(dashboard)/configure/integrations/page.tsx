import { IntegrationsDashboard } from "@/components/configure/integrations-dashboard";

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Configure external providers for communication and monitoring.
        </p>
      </div>

      <IntegrationsDashboard />
    </div>
  );
}
