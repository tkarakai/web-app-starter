"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Button,
  Input,
  Label,
} from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function SheetPage() {
  return (
    <ComponentPage
      title="Sheet"
      description="A slide-out panel anchored to the edge of the screen, built on Radix UI."
    >
      <DemoSection title="Right Side (Default)">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open Sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Sheet Title</SheetTitle>
              <SheetDescription>
                This sheet slides in from the right side of the screen. Use it
                for supplementary content or actions.
              </SheetDescription>
            </SheetHeader>
            <p className="py-4 text-sm text-muted-foreground">
              Sheets are useful for navigation, filters, or detail views that
              don&apos;t require a full page transition.
            </p>
          </SheetContent>
        </Sheet>
      </DemoSection>

      <DemoSection title="Left Side">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open Left Sheet</Button>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>
                This sheet slides in from the left, commonly used for navigation
                menus on mobile.
              </SheetDescription>
            </SheetHeader>
            <nav className="space-y-2 py-4">
              <p className="text-sm text-muted-foreground">Dashboard</p>
              <p className="text-sm text-muted-foreground">Settings</p>
              <p className="text-sm text-muted-foreground">Profile</p>
              <p className="text-sm text-muted-foreground">Help</p>
            </nav>
          </SheetContent>
        </Sheet>
      </DemoSection>

      <DemoSection title="Edit Profile Form">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Edit Profile</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Edit Profile</SheetTitle>
              <SheetDescription>
                Make changes to your profile here. Click save when you&apos;re
                done.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="sheet-name">Name</Label>
                <Input id="sheet-name" defaultValue="John Doe" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sheet-email">Email</Label>
                <Input
                  id="sheet-email"
                  type="email"
                  defaultValue="john@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sheet-username">Username</Label>
                <Input id="sheet-username" defaultValue="@johndoe" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button>Save Changes</Button>
            </div>
          </SheetContent>
        </Sheet>
      </DemoSection>
    </ComponentPage>
  );
}
