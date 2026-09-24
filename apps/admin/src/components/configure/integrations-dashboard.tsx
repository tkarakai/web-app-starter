"use client";

import { useQuery } from "convex/react";

import { api } from "@repo/backend";
import { Card, CardContent, Skeleton } from "@repo/design-system";
import { IntegrationProviderCard } from "@/components/configure/integration-provider-card";

type ProviderTab = {
  value: string;
  label: string;
  status: "connected" | "not_connected";
  summary: string;
  requiredEnv: string[];
  docsUrl: string;
};

export function IntegrationsDashboard() {
  const status = useQuery(api.integrations.getStatus, {});

  if (status === undefined) {
    return (
      <div className="max-w-2xl space-y-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!status) {
    return (
      <Card className="max-w-2xl">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Integration status is only available to admin users.
        </CardContent>
      </Card>
    );
  }

  const emailTabs = status.email as ProviderTab[];
  const smsTabs = status.sms as ProviderTab[];
  const observabilityTabs = status.observability as ProviderTab[];

  return (
    <div className="max-w-2xl space-y-6">
      <IntegrationProviderCard
        title="Email Provider"
        description="Choose the provider used for transactional and authentication emails."
        tabs={emailTabs}
      />
      <IntegrationProviderCard
        title="SMS Provider"
        description="Choose the provider used for SMS-based messaging."
        tabs={smsTabs}
      />
      <IntegrationProviderCard
        title="Observability"
        description="Configure error monitoring, telemetry, and logging providers."
        tabs={observabilityTabs}
      />
    </div>
  );
}
