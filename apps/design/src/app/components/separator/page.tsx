"use client";

import { Separator } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function SeparatorPage() {
  return (
    <ComponentPage
      title="Separator"
      description="Visual divider between content, built on Radix UI."
    >
      <DemoSection title="Horizontal">
        <div className="max-w-md space-y-4">
          <div>
            <h4 className="text-sm font-semibold">Section One</h4>
            <p className="text-sm text-muted-foreground">
              Content for the first section.
            </p>
          </div>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold">Section Two</h4>
            <p className="text-sm text-muted-foreground">
              Content for the second section.
            </p>
          </div>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold">Section Three</h4>
            <p className="text-sm text-muted-foreground">
              Content for the third section.
            </p>
          </div>
        </div>
      </DemoSection>

      <DemoSection title="Vertical">
        <div className="flex h-6 items-center gap-4">
          <span className="text-sm">Home</span>
          <Separator orientation="vertical" />
          <span className="text-sm">Dashboard</span>
          <Separator orientation="vertical" />
          <span className="text-sm">Settings</span>
          <Separator orientation="vertical" />
          <span className="text-sm">Profile</span>
        </div>
      </DemoSection>

      <DemoSection title="In a List">
        <div className="max-w-sm">
          {["Create account", "Set up profile", "Configure settings"].map(
            (item, i, arr) => (
              <div key={item}>
                <div className="py-3">
                  <p className="text-sm font-medium">{item}</p>
                  <p className="text-xs text-muted-foreground">
                    Step {i + 1} of {arr.length}
                  </p>
                </div>
                {i < arr.length - 1 && <Separator />}
              </div>
            )
          )}
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
