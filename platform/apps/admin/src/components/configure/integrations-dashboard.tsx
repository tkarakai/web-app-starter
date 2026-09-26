"use client";

import { useQuery } from "convex/react";

import { api } from "@repo/backend";
import { Card, CardContent, Skeleton } from "@web-app-starter/design-system";
import { IntegrationProviderCard } from "@/components/configure/integration-provider-card";

export function IntegrationsDashboard() {
  const status = useQuery(api.platform.integrations.getStatus, {});

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

  return (
    <div className="max-w-2xl space-y-6">
      <IntegrationProviderCard
        title="Email Provider"
        description="Choose the provider used for transactional and authentication emails."
        tabs={status.email}
      />
      <IntegrationProviderCard
        title="SMS Provider"
        description="Choose the provider used for SMS-based messaging."
        tabs={status.sms}
      />
      <IntegrationProviderCard
        title="Observability"
        description="Configure error monitoring, telemetry, and logging providers."
        tabs={status.observability}
      />
    </div>
  );
}
