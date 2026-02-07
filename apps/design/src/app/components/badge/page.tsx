"use client";

import { Badge } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function BadgePage() {
  return (
    <ComponentPage
      title="Badge"
      description="Status indicators and labels for categorizing content."
    >
      <DemoSection title="Variants">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="accent">Accent</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
      </DemoSection>

      <DemoSection title="Usage Examples">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="default">New</Badge>
          <Badge variant="secondary">Draft</Badge>
          <Badge variant="outline">v2.1.0</Badge>
          <Badge variant="accent">In Progress</Badge>
          <Badge variant="destructive">Overdue</Badge>
          <Badge variant="default">3 items</Badge>
        </div>
      </DemoSection>

      <DemoSection title="Inline with Text">
        <span className="text-sm">
          The deployment is currently{" "}
          <Badge variant="accent">running</Badge> and was last
          updated <Badge variant="secondary">2 hours ago</Badge>.
        </span>
      </DemoSection>
    </ComponentPage>
  );
}
