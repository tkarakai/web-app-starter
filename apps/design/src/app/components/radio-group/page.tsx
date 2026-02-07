"use client";

import * as React from "react";
import { RadioGroup, RadioGroupItem, Label } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function RadioGroupPage() {
  return (
    <ComponentPage
      title="Radio Group"
      description="A set of mutually exclusive options, built on Radix UI."
    >
      <DemoSection title="Basic Radio Group">
        <RadioGroup defaultValue="default">
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="default" id="r1" />
            <Label htmlFor="r1">Default</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="comfortable" id="r2" />
            <Label htmlFor="r2">Comfortable</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="compact" id="r3" />
            <Label htmlFor="r3">Compact</Label>
          </div>
        </RadioGroup>
      </DemoSection>

      <DemoSection title="Horizontal Layout">
        <RadioGroup defaultValue="option-1" className="flex gap-6">
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="option-1" id="h1" />
            <Label htmlFor="h1">Option 1</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="option-2" id="h2" />
            <Label htmlFor="h2">Option 2</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="option-3" id="h3" />
            <Label htmlFor="h3">Option 3</Label>
          </div>
        </RadioGroup>
      </DemoSection>
    </ComponentPage>
  );
}
