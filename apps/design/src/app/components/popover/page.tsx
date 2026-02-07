"use client";

import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger, Button, Input, Label } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function PopoverPage() {
  return (
    <ComponentPage
      title="Popover"
      description="Floating content panel triggered by a button, built on Radix UI."
    >
      <DemoSection title="Basic Popover">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Open Popover</Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="space-y-2">
              <h4 className="font-medium leading-none">Popover</h4>
              <p className="text-sm text-muted-foreground">
                This is a basic popover with some informational text content.
              </p>
            </div>
          </PopoverContent>
        </Popover>
      </DemoSection>

      <DemoSection title="Dimensions Popover">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Set Dimensions</Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="space-y-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Dimensions</h4>
                <p className="text-sm text-muted-foreground">
                  Set the dimensions for the layer.
                </p>
              </div>
              <div className="grid gap-3">
                <div className="grid grid-cols-3 items-center gap-4">
                  <Label htmlFor="popover-width">Width</Label>
                  <Input
                    id="popover-width"
                    defaultValue="100%"
                    className="col-span-2"
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <Label htmlFor="popover-height">Height</Label>
                  <Input
                    id="popover-height"
                    defaultValue="25px"
                    className="col-span-2"
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <Label htmlFor="popover-maxwidth">Max. width</Label>
                  <Input
                    id="popover-maxwidth"
                    defaultValue="300px"
                    className="col-span-2"
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <Label htmlFor="popover-maxheight">Max. height</Label>
                  <Input
                    id="popover-maxheight"
                    defaultValue="none"
                    className="col-span-2"
                  />
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </DemoSection>
    </ComponentPage>
  );
}
