"use client";

import * as React from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function DialogPage() {
  const [formOpen, setFormOpen] = React.useState(false);

  return (
    <ComponentPage
      title="Dialog"
      description="Modal dialog for focused interactions, built on Radix UI."
    >
      <DemoSection title="Basic Dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open Dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dialog Title</DialogTitle>
              <DialogDescription>
                This is a basic dialog. Click the X or press Escape to close.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Dialogs are used for important actions that require user
              attention. They interrupt the user flow and demand a response.
            </p>
          </DialogContent>
        </Dialog>
      </DemoSection>

      <DemoSection title="Dialog with Form">
        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">Edit Profile</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Profile</DialogTitle>
              <DialogDescription>
                Make changes to your profile. Click save when done.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="dialog-name">Name</Label>
                <Input id="dialog-name" defaultValue="John Doe" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dialog-email">Email</Label>
                <Input
                  id="dialog-email"
                  type="email"
                  defaultValue="john@example.com"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={() => setFormOpen(false)}>
                Save Changes
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DemoSection>

      <DemoSection title="Confirmation Dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Delete Item</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Are you sure?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. This will permanently delete
                the item and remove it from our servers.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline">Cancel</Button>
              <Button>Delete</Button>
            </div>
          </DialogContent>
        </Dialog>
      </DemoSection>
    </ComponentPage>
  );
}
