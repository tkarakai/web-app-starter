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

      <DemoSection title="Sizes">
        <div className="max-w-sm space-y-4">
          <div className="space-y-2">
            <Label htmlFor="textarea-sm">Small</Label>
            <Textarea
              id="textarea-sm"
              textareaSize="sm"
              placeholder="Small textarea"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="textarea-md">Medium (default)</Label>
            <Textarea
              id="textarea-md"
              textareaSize="md"
              placeholder="Medium textarea"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="textarea-lg">Large</Label>
            <Textarea
              id="textarea-lg"
              textareaSize="lg"
              placeholder="Large textarea"
            />
          </div>
        </div>
      </DemoSection>

      <DemoSection title="Error Variant">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="textarea-error">Description</Label>
          <Textarea
            id="textarea-error"
            variant="error"
            placeholder="Write a description..."
            defaultValue="Too short"
          />
          <p className="text-xs text-destructive">
            Description must be at least 20 characters.
          </p>
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
