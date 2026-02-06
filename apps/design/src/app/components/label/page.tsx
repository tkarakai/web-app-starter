"use client";

import { Input, Label } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function LabelPage() {
  return (
    <ComponentPage
      title="Label"
      description="Accessible label for form controls, built on Radix UI."
    >
      <DemoSection title="With Input">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="label-name">Full Name</Label>
          <Input id="label-name" placeholder="Jane Doe" />
        </div>
      </DemoSection>

      <DemoSection title="Multiple Fields">
        <div className="max-w-sm space-y-4">
          <div className="space-y-2">
            <Label htmlFor="label-first">First Name</Label>
            <Input id="label-first" placeholder="Jane" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label-last">Last Name</Label>
            <Input id="label-last" placeholder="Doe" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label-email">Email</Label>
            <Input
              id="label-email"
              type="email"
              placeholder="jane@example.com"
            />
          </div>
        </div>
      </DemoSection>

      <DemoSection title="Inline Layout">
        <div className="flex items-center gap-3">
          <Label htmlFor="label-inline" className="whitespace-nowrap">
            Search:
          </Label>
          <Input id="label-inline" placeholder="Type to search..." />
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
