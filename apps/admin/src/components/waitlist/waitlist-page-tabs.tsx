"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/design-system";

import { EmailTemplateEditor } from "./email-template-editor";
import { WaitlistDataTable } from "./waitlist-data-table";

export function WaitlistPageTabs() {
  const [activeTab, setActiveTab] = React.useState("entries");
  const [editorDirty, setEditorDirty] = React.useState(false);
  const [pendingTab, setPendingTab] = React.useState<string | null>(null);

  const handleTabChange = (value: string) => {
    if (editorDirty) {
      setPendingTab(value);
      return;
    }
    setActiveTab(value);
  };

  const confirmTabSwitch = () => {
    if (pendingTab) {
      setEditorDirty(false);
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  };

  return (
    <>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="entries">Entries</TabsTrigger>
          <TabsTrigger value="email-template">Email Template</TabsTrigger>
        </TabsList>

        <TabsContent value="entries">
          <WaitlistDataTable />
        </TabsContent>

        <TabsContent value="email-template">
          <EmailTemplateEditor onDirtyChange={setEditorDirty} />
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={pendingTab !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTab(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to the email template. Switching tabs
              will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmTabSwitch}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
