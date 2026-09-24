"use client";

import * as React from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/design-system";

type ProviderState = "connected" | "not_connected";

type IntegrationTab = {
  value: string;
  label: string;
  status: ProviderState;
  summary: string;
  requiredEnv: string[];
  docsUrl: string;
};

type IntegrationProviderCardProps = {
  title: string;
  description: string;
  tabs: IntegrationTab[];
  onTestConnection?: (
    provider: string
  ) => Promise<{ ok: boolean; message: string }>;
  onSave?: (provider: string, payload: Record<string, string>) => Promise<void>;
};

function statusLabel(status: ProviderState): string {
  return status === "connected" ? "Connected" : "Not connected";
}

function statusVariant(status: ProviderState): "default" | "outline" {
  return status === "connected" ? "default" : "outline";
}

export function IntegrationProviderCard({
  title,
  description,
  tabs,
  onTestConnection,
  onSave,
}: IntegrationProviderCardProps) {
  const firstTab = tabs[0];
  const [activeTab, setActiveTab] = React.useState(firstTab?.value ?? "");
  const [testingProvider, setTestingProvider] = React.useState<string | null>(null);
  const [testMessage, setTestMessage] = React.useState<string | null>(null);
  const [savingProvider, setSavingProvider] = React.useState<string | null>(null);

  if (!firstTab) return null;

  const handleTestConnection = async (provider: string) => {
    if (!onTestConnection) return;
    setTestingProvider(provider);
    setTestMessage(null);

    try {
      const result = await onTestConnection(provider);
      setTestMessage(result.message);
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : "Connection test failed.");
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSave = async (provider: string) => {
    if (!onSave) return;
    setSavingProvider(provider);
    setTestMessage(null);

    try {
      await onSave(provider, {});
      setTestMessage("Configuration saved.");
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : "Failed to save configuration.");
    } finally {
      setSavingProvider(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start overflow-x-auto">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-4 space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(tab.status)}>{statusLabel(tab.status)}</Badge>
                <span className="text-sm text-muted-foreground">{tab.summary}</span>
              </div>

              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Required environment variables
                </p>
                {tab.requiredEnv.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No required variables.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-foreground">
                    {tab.requiredEnv.map((item) => (
                      <li key={item} className="font-mono text-xs">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" asChild>
                  <a href={tab.docsUrl} target="_blank" rel="noreferrer">
                    Open provider docs
                  </a>
                </Button>

                {onTestConnection ? (
                  <Button
                    variant="secondary"
                    onClick={() => void handleTestConnection(tab.value)}
                    disabled={testingProvider === tab.value}
                  >
                    {testingProvider === tab.value ? "Testing..." : "Test connection"}
                  </Button>
                ) : null}

                {onSave ? (
                  <Button
                    onClick={() => void handleSave(tab.value)}
                    disabled={savingProvider === tab.value}
                  >
                    {savingProvider === tab.value ? "Saving..." : "Save"}
                  </Button>
                ) : null}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {testMessage ? (
          <p className="rounded-md border border-border/60 bg-muted px-3 py-2 text-sm text-muted-foreground">
            {testMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
