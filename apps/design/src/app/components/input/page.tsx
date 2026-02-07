"use client";

import * as React from "react";
import { Input, Label } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function InputPage() {
  const [value, setValue] = React.useState("");

  return (
    <ComponentPage
      title="Input"
      description="Single-line text input field for forms."
    >
      <DemoSection title="Default">
        <div className="max-w-sm">
          <Input placeholder="Type something..." />
        </div>
      </DemoSection>

      <DemoSection title="Sizes">
        <div className="max-w-sm space-y-4">
          <div className="space-y-2">
            <Label htmlFor="input-sm">Small</Label>
            <Input
              id="input-sm"
              inputSize="sm"
              placeholder="Small input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="input-md">Medium (default)</Label>
            <Input
              id="input-md"
              inputSize="md"
              placeholder="Medium input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="input-lg">Large</Label>
            <Input
              id="input-lg"
              inputSize="lg"
              placeholder="Large input"
            />
          </div>
        </div>
      </DemoSection>

      <DemoSection title="Error Variant">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="input-error">Email address</Label>
          <Input
            id="input-error"
            variant="error"
            type="email"
            placeholder="john@example.com"
            defaultValue="invalid-email"
          />
          <p className="text-xs text-destructive">
            Please enter a valid email address.
          </p>
        </div>
      </DemoSection>

      <DemoSection title="Ghost Variant">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="input-ghost">Inline edit</Label>
          <Input
            id="input-ghost"
            variant="ghost"
            placeholder="Click to edit..."
          />
        </div>
      </DemoSection>

      <DemoSection title="With Label">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="input-email">Email address</Label>
          <Input
            id="input-email"
            type="email"
            placeholder="john@example.com"
          />
        </div>
      </DemoSection>

      <DemoSection title="Input Types">
        <div className="max-w-sm space-y-4">
          <div className="space-y-2">
            <Label htmlFor="input-text">Text</Label>
            <Input id="input-text" type="text" placeholder="Plain text" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="input-password">Password</Label>
            <Input
              id="input-password"
              type="password"
              placeholder="Enter password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="input-number">Number</Label>
            <Input
              id="input-number"
              type="number"
              placeholder="42"
            />
          </div>
        </div>
      </DemoSection>

      <DemoSection title="Controlled Input">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="input-controlled">Type to see character count</Label>
          <Input
            id="input-controlled"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Start typing..."
          />
          <p className="text-xs text-muted-foreground">
            {value.length} character{value.length !== 1 ? "s" : ""}
          </p>
        </div>
      </DemoSection>

      <DemoSection title="Disabled">
        <div className="max-w-sm">
          <Input disabled placeholder="Cannot edit this" />
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
