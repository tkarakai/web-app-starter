"use client";

import * as React from "react";
import { useQuery } from "convex/react";

import { api } from "@repo/backend";
import { type Id } from "@repo/backend";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Separator,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/design-system";
import { useAuthUser } from "@/components/auth/auth-guard";
import { AppSidebar } from "@/components/projects/app-sidebar";
import { EmptyState } from "@/components/projects/empty-state";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectSummary } from "@/components/projects/project-summary";
import { TaskList } from "@/components/projects/task-list";
import { UploadPanel } from "@/components/projects/upload-panel";

export function DashboardClient() {
  const authUser = useAuthUser();

  const [selectedProjectId, setSelectedProjectId] = React.useState<Id<"projects"> | null>(null);

  const displayName = authUser?.name ?? "Anonymous";
  const displayEmail = authUser?.email;

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
          <DashboardBreadcrumbs
            selectedProjectId={selectedProjectId}
            onNavigateToProjects={() => setSelectedProjectId(null)}
          />
        </header>

        <div className="flex flex-1 flex-col">
          {selectedProjectId ? (
            <ProjectContent
              projectId={selectedProjectId}
              onDeleted={() => setSelectedProjectId(null)}
            />
          ) : (
            <ProjectsOverview onSelectProject={setSelectedProjectId} />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function DashboardBreadcrumbs({
  selectedProjectId,
  onNavigateToProjects,
}: {
  selectedProjectId: Id<"projects"> | null;
  onNavigateToProjects: () => void;
}) {
  const project = useQuery(
    api.projects.get,
    selectedProjectId ? { id: selectedProjectId } : "skip"
  );

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {selectedProjectId ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink
                className="cursor-pointer"
                onClick={onNavigateToProjects}
              >
                Projects
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{project?.name ?? "..."}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage>Projects</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function ProjectsOverview({
  onSelectProject,
}: {
  onSelectProject: (id: Id<"projects">) => void;
}) {
  const projects = useQuery(api.projects.list);

  if (projects === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        description="Create a project to get started."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <ProjectSummary onSelectProject={onSelectProject} />
    </div>
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
      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="attachments">Attachments</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks" className="mt-4">
          <TaskList projectId={projectId} />
        </TabsContent>
        <TabsContent value="attachments" className="mt-4">
          <UploadPanel projectId={projectId} collapsible={false} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
