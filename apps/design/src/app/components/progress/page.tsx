"use client";

import * as React from "react";
import { Button, Progress } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function ProgressPage() {
  const [value, setValue] = React.useState(45);
  const [animating, setAnimating] = React.useState(false);

  function startAnimation() {
    setAnimating(true);
    setValue(0);
    let current = 0;
    const interval = setInterval(() => {
      current += 2;
      setValue(current);
      if (current >= 100) {
        clearInterval(interval);
        setAnimating(false);
      }
    }, 50);
  }

  return (
    <ComponentPage
      title="Progress"
      description="Show completion progress with an animated bar, built on Radix UI."
    >
      <DemoSection title="Static Values">
        <div className="max-w-md space-y-4">
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0%</span>
            </div>
            <Progress value={0} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>25%</span>
            </div>
            <Progress value={25} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>50%</span>
            </div>
            <Progress value={50} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>75%</span>
            </div>
            <Progress value={75} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>100%</span>
            </div>
            <Progress value={100} />
          </div>
        </div>
      </DemoSection>

      <DemoSection title="Interactive Slider">
        <div className="max-w-md space-y-4">
          <Progress value={value} />
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0}
              max={100}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-right text-sm font-mono">
              {value}%
            </span>
          </div>
        </div>
      </DemoSection>

      <DemoSection title="Animated Progress">
        <div className="max-w-md space-y-4">
          <Progress value={value} />
          <div className="flex items-center gap-3">
            <Button
              onClick={startAnimation}
              disabled={animating}
              size="sm"
            >
              {animating ? "Running..." : "Start Animation"}
            </Button>
            <span className="text-sm text-muted-foreground">
              {value}% complete
            </span>
          </div>
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
