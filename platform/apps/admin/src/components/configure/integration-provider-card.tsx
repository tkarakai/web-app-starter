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
} from "@web-app-starter/design-system";

type ProviderState = "connected" | "not_connected" | "not_implemented";

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
};

const STATUS_BADGE: Record<
  ProviderState,
  { label: string; variant: "default" | "outline" | "secondary" }
> = {
  connected: { label: "Connected", variant: "default" },
  not_connected: { label: "Not connected", variant: "outline" },
  not_implemented: { label: "Not available", variant: "secondary" },
};

export function IntegrationProviderCard({
  title,
  description,
  tabs,
}: IntegrationProviderCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={tabs[0]?.value}>
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
                <Badge variant={STATUS_BADGE[tab.status].variant}>
                  {STATUS_BADGE[tab.status].label}
                </Badge>
                <span className="text-sm text-muted-foreground">{tab.summary}</span>
              </div>

              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Environment variables
                </p>
                <ul className="space-y-1">
                  {tab.requiredEnv.map((name) => (
                    <li key={name} className="font-mono text-xs text-foreground">
                      {name}
                    </li>
                  ))}
                </ul>
              </div>

              <Button variant="outline" size="sm" asChild>
                <a href={tab.docsUrl} target="_blank" rel="noreferrer">
                  Provider docs
                </a>
              </Button>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
