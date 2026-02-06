"use client";

import * as React from "react";
import { Label, Textarea } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function TextareaPage() {
  const [value, setValue] = React.useState("");
  const maxLength = 200;

  return (
    <ComponentPage
      title="Textarea"
      description="Multi-line text input field for longer content."
    >
      <DemoSection title="Default">
        <div className="max-w-sm">
          <Textarea placeholder="Write your message..." />
        </div>
      </DemoSection>

      <DemoSection title="With Label">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="textarea-bio">Bio</Label>
          <Textarea
            id="textarea-bio"
            placeholder="Tell us about yourself..."
          />
        </div>
      </DemoSection>

      <DemoSection title="Character Count">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="textarea-limited">
            Description (max {maxLength} characters)
          </Label>
          <Textarea
            id="textarea-limited"
            value={value}
            onChange={(e) =>
              setValue(e.target.value.slice(0, maxLength))
            }
            placeholder="Write a short description..."
          />
          <p className="text-xs text-muted-foreground text-right">
            {value.length}/{maxLength}
          </p>
        </div>
      </DemoSection>

      <DemoSection title="Disabled">
        <div className="max-w-sm">
          <Textarea
            disabled
            placeholder="This textarea is disabled"
          />
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
