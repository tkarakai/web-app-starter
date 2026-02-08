"use client";

import { DemoSection } from "@/components/demo-section";

const spacingScale = [
  { name: "0.5", px: 2 },
  { name: "1", px: 4 },
  { name: "1.5", px: 6 },
  { name: "2", px: 8 },
  { name: "3", px: 12 },
  { name: "4", px: 16 },
  { name: "5", px: 20 },
  { name: "6", px: 24 },
  { name: "8", px: 32 },
  { name: "10", px: 40 },
  { name: "12", px: 48 },
  { name: "16", px: 64 },
  { name: "20", px: 80 },
  { name: "24", px: 96 },
];

export default function SpacingShowcase() {
  return (
    <>
      <DemoSection
        title="Spacing Scale"
        description="The core spacing values used for padding, margin, gap, and sizing throughout the design system."
      >
        <div className="space-y-2">
          {spacingScale.map(({ name, px }) => (
            <div key={name} className="flex items-center gap-3">
              <div className="w-16 shrink-0 text-right">
                <span className="text-xs font-mono text-muted-foreground">
                  {name}
                </span>
              </div>
              <div className="w-14 shrink-0">
                <span className="text-xs text-muted-foreground/60">
                  {px}px
                </span>
              </div>
              <div
                className="h-3 bg-primary"
                style={{ width: `${px}px` }}
              />
            </div>
          ))}
        </div>
      </DemoSection>

      <DemoSection
        title="Common Combinations"
        description="Typical spacing patterns used in component layouts."
      >
        <div className="space-y-6">
          <div>
            <p className="text-xs font-medium text-foreground mb-2">
              gap-2 (8px) — Inline elements
            </p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-8 w-8 rounded bg-primary/20 border border-primary/30"
                />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-foreground mb-2">
              gap-4 (16px) — Card grids
            </p>
            <div className="flex gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-12 w-12 rounded-md bg-primary/20 border border-primary/30"
                />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-foreground mb-2">
              p-6 (24px) — Container padding
            </p>
            <div className="p-6 rounded-lg border border-dashed border-primary/30 bg-primary/5">
              <div className="h-8 rounded bg-primary/20 border border-primary/30" />
            </div>
          </div>
        </div>
      </DemoSection>
    </>
  );
}
