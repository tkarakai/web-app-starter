"use client";

import * as React from "react";
import { usePreloadedAuthQuery } from "@convex-dev/better-auth/nextjs/client";
import { Preloaded, useQuery } from "convex/react";

import { api } from "@repo/backend";
import { type Id } from "@repo/backend";
import { authClient } from "@repo/auth/client";
import {
  Separator,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/design-system";
import { AppSidebar } from "@/components/projects/app-sidebar";
import { EmptyState } from "@/components/projects/empty-state";
import { ProjectHeader } from "@/components/projects/project-header";
import { TaskList } from "@/components/projects/task-list";
import { UploadPanel } from "@/components/projects/upload-panel";

type DashboardClientProps = {
  preloadedUser: Preloaded<typeof api.auth.getCurrentUser>;
};

export function DashboardClient({ preloadedUser }: DashboardClientProps) {
  const user = usePreloadedAuthQuery(preloadedUser);
  const session = authClient.useSession();

  const [selectedProjectId, setSelectedProjectId] = React.useState<Id<"projects"> | null>(null);

  const displayName = user?.name ?? session.data?.user?.name ?? "Anonymous";
  const displayEmail = user?.email ?? session.data?.user?.email;

  return (
    <SidebarProvider>
      <AppSidebar
        displayName={displayName}
        displayEmail={displayEmail ?? undefined}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/40 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <span className="text-sm font-medium text-foreground">Dashboard</span>
        </header>

        <div className="flex flex-1 flex-col">
          {selectedProjectId ? (
            <ProjectContent
              projectId={selectedProjectId}
              onDeleted={() => setSelectedProjectId(null)}
            />
          ) : (
            <EmptyState
              title="No project selected"
              description="Create a project to get started, or select one from the sidebar."
            />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ProjectContent({
  projectId,
  onDeleted,
}: {
  projectId: Id<"projects">;
  onDeleted: () => void;
}) {
  const project = useQuery(api.projects.get, { id: projectId });

  if (project === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (project === null) {
    return (
      <EmptyState
        title="Project not found"
        description="This project may have been deleted."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <ProjectHeader project={project} onDeleted={onDeleted} />
      <TaskList projectId={projectId} />
      <UploadPanel />
    </div>
  );
}
