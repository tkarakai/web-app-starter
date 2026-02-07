"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Label,
} from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function SelectPage() {
  return (
    <ComponentPage
      title="Select"
      description="A dropdown menu for selecting a single value from a list, built on Radix UI."
    >
      <DemoSection title="Basic Select">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="select-fruit">Favorite fruit</Label>
          <Select>
            <SelectTrigger id="select-fruit">
              <SelectValue placeholder="Select a fruit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="apple">Apple</SelectItem>
              <SelectItem value="banana">Banana</SelectItem>
              <SelectItem value="orange">Orange</SelectItem>
              <SelectItem value="grape">Grape</SelectItem>
              <SelectItem value="mango">Mango</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </DemoSection>

      <DemoSection title="With Groups">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="select-grouped">Produce</Label>
          <Select>
            <SelectTrigger id="select-grouped">
              <SelectValue placeholder="Select an item" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Fruits</SelectLabel>
                <SelectItem value="apple">Apple</SelectItem>
                <SelectItem value="banana">Banana</SelectItem>
                <SelectItem value="blueberry">Blueberry</SelectItem>
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Vegetables</SelectLabel>
                <SelectItem value="carrot">Carrot</SelectItem>
                <SelectItem value="broccoli">Broccoli</SelectItem>
                <SelectItem value="spinach">Spinach</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </DemoSection>

      <DemoSection title="Disabled">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="select-disabled" className="text-muted-foreground">
            Disabled select
          </Label>
          <Select disabled>
            <SelectTrigger id="select-disabled">
              <SelectValue placeholder="Cannot interact" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">Option A</SelectItem>
              <SelectItem value="b">Option B</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
