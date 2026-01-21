import { Calendar, Flag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { toPriorityLabel, toStatusCopy, type LaunchStatus } from "@/lib/launchpad";

export type LaunchItem = {
  _id: string;
  title: string;
  description: string;
  status: LaunchStatus;
  priority: number;
  createdAt: number;
};

const statusVariant: Record<LaunchStatus, "secondary" | "accent" | "default"> = {
  idea: "secondary",
  building: "accent",
  shipping: "default",
};

export function LaunchItemCard({ item }: { item: LaunchItem }) {
  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
          </div>
          <Badge variant={statusVariant[item.status]}>{toStatusCopy(item.status)}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Flag className="h-3.5 w-3.5" />
            {toPriorityLabel(item.priority)} priority
          </span>
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatDateTime(item.createdAt)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
