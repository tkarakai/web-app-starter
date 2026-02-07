"use client";

import * as React from "react";
import { Switch, Label } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function SwitchPage() {
  const [enabled, setEnabled] = React.useState(false);

  return (
    <ComponentPage
      title="Switch"
      description="A toggle switch for on/off states, built on Radix UI."
    >
      <DemoSection title="Basic Switch">
        <Switch />
      </DemoSection>

      <DemoSection title="With Label">
        <div className="flex items-center space-x-2">
          <Switch id="switch-label" />
          <Label htmlFor="switch-label">Airplane Mode</Label>
        </div>
      </DemoSection>

      <DemoSection title="Controlled Switch">
        <div className="flex items-center space-x-2">
          <Switch
            id="switch-controlled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <Label htmlFor="switch-controlled">
            {enabled ? "On" : "Off"}
          </Label>
        </div>
      </DemoSection>

      <DemoSection title="Disabled">
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Switch id="switch-disabled" disabled />
            <Label htmlFor="switch-disabled" className="text-muted-foreground">
              Disabled off
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Switch id="switch-disabled-on" disabled checked />
            <Label htmlFor="switch-disabled-on" className="text-muted-foreground">
              Disabled on
            </Label>
          </div>
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
