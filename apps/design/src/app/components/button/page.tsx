"use client";

import * as React from "react";
import { ArrowRight, Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { Button } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function ButtonPage() {
  const [loading, setLoading] = React.useState(false);

  function handleLoadingClick() {
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  }

  return (
    <ComponentPage
      title="Button"
      description="Trigger actions and events with multiple variants and sizes."
    >
      <DemoSection title="Variants">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="default">Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
      </DemoSection>

      <DemoSection title="Sizes">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="icon">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </DemoSection>

      <DemoSection title="With Icons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Mail className="h-4 w-4" />
            Send Email
          </Button>
          <Button variant="outline">
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
          <Button variant="secondary">
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="destructive">
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <Button variant="secondary" size="sm">
            <Mail className="h-4 w-4" />
            Compact
          </Button>
        </div>
      </DemoSection>

      <DemoSection title="Icon Only">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="icon" variant="default">
            <Plus className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="secondary">
            <Mail className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="outline">
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </DemoSection>

      <DemoSection title="Loading State">
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled onClick={handleLoadingClick}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Saving..." : "Click to save"}
          </Button>
          <Button onClick={handleLoadingClick}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Saving..." : "Click to save"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading for 2 seconds..."
              : "Click the button to see the loading state."}
          </p>
        </div>
      </DemoSection>

      <DemoSection title="Destructive Variant">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="destructive">Delete Account</Button>
          <Button variant="destructive" size="sm">
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
          <Button variant="destructive" size="icon">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </DemoSection>

      <DemoSection title="Link Variant">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="link">Learn more</Button>
          <Button variant="link">
            View documentation
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="link" size="sm">
            Small link
          </Button>
        </div>
      </DemoSection>

      <DemoSection title="Disabled">
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>Default</Button>
          <Button variant="secondary" disabled>
            Secondary
          </Button>
          <Button variant="outline" disabled>
            Outline
          </Button>
          <Button variant="ghost" disabled>
            Ghost
          </Button>
          <Button variant="destructive" disabled>
            Destructive
          </Button>
          <Button variant="link" disabled>
            Link
          </Button>
        </div>
      </DemoSection>

      <DemoSection title="All Variants x All Sizes">
        <div className="space-y-3">
          {(
            [
              "default",
              "secondary",
              "outline",
              "ghost",
              "destructive",
              "link",
            ] as const
          ).map((variant) => (
            <div key={variant} className="flex items-center gap-3">
              <span className="w-24 text-xs font-mono text-muted-foreground">
                {variant}
              </span>
              <Button variant={variant} size="sm">
                Small
              </Button>
              <Button variant={variant} size="md">
                Medium
              </Button>
              <Button variant={variant} size="lg">
                Large
              </Button>
              <Button variant={variant} size="icon">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
