"use client";

import { Bold, Italic, Underline } from "lucide-react";
import { Toggle } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function TogglePage() {
  return (
    <ComponentPage
      title="Toggle"
      description="A two-state button that can be toggled on or off."
    >
      <DemoSection title="Basic Toggle">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle aria-label="Toggle bold">
            <Bold className="h-4 w-4" />
          </Toggle>
          <Toggle aria-label="Toggle italic">
            <Italic className="h-4 w-4" />
          </Toggle>
          <Toggle aria-label="Toggle underline">
            <Underline className="h-4 w-4" />
          </Toggle>
        </div>
      </DemoSection>

      <DemoSection title="With Text">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle aria-label="Toggle bold">
            <Bold className="h-4 w-4" />
            Bold
          </Toggle>
          <Toggle aria-label="Toggle italic">
            <Italic className="h-4 w-4" />
            Italic
          </Toggle>
          <Toggle aria-label="Toggle underline">
            <Underline className="h-4 w-4" />
            Underline
          </Toggle>
        </div>
      </DemoSection>

      <DemoSection title="Outline Variant">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle variant="outline" aria-label="Toggle bold">
            <Bold className="h-4 w-4" />
          </Toggle>
          <Toggle variant="outline" aria-label="Toggle italic">
            <Italic className="h-4 w-4" />
          </Toggle>
          <Toggle variant="outline" aria-label="Toggle underline">
            <Underline className="h-4 w-4" />
          </Toggle>
        </div>
      </DemoSection>

      <DemoSection title="Sizes">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle size="sm" aria-label="Toggle bold (small)">
            <Bold className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle size="md" aria-label="Toggle bold (medium)">
            <Bold className="h-4 w-4" />
          </Toggle>
          <Toggle size="lg" aria-label="Toggle bold (large)">
            <Bold className="h-5 w-5" />
          </Toggle>
        </div>
      </DemoSection>

      <DemoSection title="Disabled">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle disabled aria-label="Toggle bold (disabled)">
            <Bold className="h-4 w-4" />
          </Toggle>
          <Toggle variant="outline" disabled aria-label="Toggle italic (disabled)">
            <Italic className="h-4 w-4" />
          </Toggle>
        </div>
      </DemoSection>

      <DemoSection title="Default Pressed">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle defaultPressed aria-label="Toggle bold (pressed)">
            <Bold className="h-4 w-4" />
          </Toggle>
          <Toggle variant="outline" defaultPressed aria-label="Toggle italic (pressed)">
            <Italic className="h-4 w-4" />
          </Toggle>
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
