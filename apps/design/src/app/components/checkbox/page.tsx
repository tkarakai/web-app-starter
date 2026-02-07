"use client";

import * as React from "react";
import { Checkbox, Label } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function CheckboxPage() {
  const [checked, setChecked] = React.useState(false);
  const [terms, setTerms] = React.useState(false);

  return (
    <ComponentPage
      title="Checkbox"
      description="A toggle control for binary choices, built on Radix UI."
    >
      <DemoSection title="Basic Checkbox">
        <Checkbox />
      </DemoSection>

      <DemoSection title="With Label">
        <div className="flex items-center space-x-2">
          <Checkbox id="checkbox-label" />
          <Label htmlFor="checkbox-label">Accept notifications</Label>
        </div>
      </DemoSection>

      <DemoSection title="Checked State">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="checkbox-controlled"
            checked={checked}
            onCheckedChange={(value) => setChecked(value === true)}
          />
          <Label htmlFor="checkbox-controlled">
            {checked ? "Checked" : "Unchecked"}
          </Label>
        </div>
      </DemoSection>

      <DemoSection title="Disabled">
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Checkbox id="checkbox-disabled" disabled />
            <Label htmlFor="checkbox-disabled" className="text-muted-foreground">
              Disabled unchecked
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="checkbox-disabled-checked" disabled checked />
            <Label htmlFor="checkbox-disabled-checked" className="text-muted-foreground">
              Disabled checked
            </Label>
          </div>
        </div>
      </DemoSection>

      <DemoSection title="Terms & Conditions">
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="checkbox-terms"
              checked={terms}
              onCheckedChange={(value) => setTerms(value === true)}
            />
            <Label htmlFor="checkbox-terms" className="text-sm leading-none">
              I agree to the{" "}
              <span className="underline underline-offset-2">
                terms and conditions
              </span>
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {terms
              ? "You have accepted the terms."
              : "You must accept the terms to continue."}
          </p>
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
