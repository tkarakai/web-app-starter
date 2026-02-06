import { Calendar, Flag, Pencil } from "lucide-react";

import { Badge, Button, Card, CardContent } from "@repo/ui";
import { type Id } from "@repo/backend";
import { formatDateTime } from "@/lib/format";
import { toPriorityLabel, toStatusCopy, type LaunchStatus } from "@/lib/launchpad";

export type LaunchItem = {
  _id: Id<"launchItems">;
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

type LaunchItemCardProps = {
  item: LaunchItem;
  onEdit?: (item: LaunchItem) => void;
};

export function LaunchItemCard({ item, onEdit }: LaunchItemCardProps) {
  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant[item.status]}>{toStatusCopy(item.status)}</Badge>
            {onEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(item)}
                className="h-8 w-8 p-0"
              >
                <Pencil className="h-4 w-4" />
                <span className="sr-only">Edit item</span>
              </Button>
            )}
          </div>
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
