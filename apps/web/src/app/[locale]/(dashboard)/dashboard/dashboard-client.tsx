"use client";

import { Breadcrumb, SidebarTrigger } from "@/components/ui/localized-controls";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { api } from "@repo/backend";
import { type Id } from "@repo/backend";
import {
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Separator,
  SidebarInset,
  SidebarProvider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@web-app-starter/design-system";
import { NoOrganization, OrganizationInvitations, useAuthUser, useOrganizations } from "@web-app-starter/auth-ui";
import { useProfileSync } from "@/hooks/useProfileSync";
import { AppSidebar } from "@/components/projects/app-sidebar";
import { AnnouncementBannerHost } from "@/components/announcement-banner-host";
import { EmptyState } from "@/components/projects/empty-state";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectSummary } from "@/components/projects/project-summary";
import { TaskList } from "@/components/projects/task-list";
import { UploadPanel } from "@/components/projects/upload-panel";

export function DashboardClient() {
  // Sync user profile (locale) between Convex and localStorage
  // This is safe here because we're in the authenticated dashboard area with proper context
  useProfileSync();

  const authUser = useAuthUser();
  const organizations = useOrganizations();
  const hasOrganization = Boolean(organizations?.activeOrganizationId);
  const tc = useTranslations("common");

  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const projects = useQuery(api.projects.list, hasOrganization ? {} : "skip");
  // Resolve the URL selection against this organization's actual IDs before querying a project.
  const selectedProjectId = projects?.find(project => project._id === search.get("project"))?._id ?? null;
  const tab = search.get("tab") === "attachments" ? "attachments" : "tasks";
  const replaceSearch = (params: URLSearchParams) => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  const setSelectedProjectId = (projectId: Id<"projects"> | null) => {
    const params = new URLSearchParams(search.toString());
    if (projectId) params.set("project", projectId); else params.delete("project");
    params.delete("tab");
    replaceSearch(params);
  };

  const displayName = authUser?.name ?? tc("anonymous");
  const displayEmail = authUser?.email;

  return (
    <SidebarProvider>
      <AppSidebar
        displayName={displayName}
        displayEmail={displayEmail ?? undefined}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
      />
      <SidebarInset className="flex flex-col h-dvh">
        <AnnouncementBannerHost className="shrink-0" />
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/40 bg-background px-4">
          <SidebarTrigger className="-ms-1" />
          {hasOrganization && <Separator
            orientation="vertical"
            className="me-2 data-[orientation=vertical]:h-4"
          />}
          {hasOrganization && <DashboardBreadcrumbs
            selectedProjectId={selectedProjectId}
            onNavigateToProjects={() => setSelectedProjectId(null)}
          />}
        </header>

        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-6 pt-4 empty:hidden">
            <OrganizationInvitations onAccepted={() => setSelectedProjectId(null)} />
          </div>
          {organizations === undefined || hasOrganization && search.has("project") && projects === undefined ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{tc("loading")}</div>
          ) : !hasOrganization ? (
            <NoOrganization />
          ) : selectedProjectId ? (
            <ProjectContent
              projectId={selectedProjectId}
              onDeleted={() => setSelectedProjectId(null)}
              tab={tab}
              onTabChange={(value) => {
                const params = new URLSearchParams(search.toString());
                if (value === "attachments") params.set("tab", value); else params.delete("tab");
                replaceSearch(params);
              }}
            />
          ) : (
            <ProjectsOverview onSelectProject={setSelectedProjectId} />
          )}
        </div>
        <footer className="sticky bottom-0 shrink-0 h-5 border-t border-border/40 bg-background" />
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
  const td = useTranslations("dashboard");
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
                {td("projects")}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{project?.name ?? "..."}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage>{td("projects")}</BreadcrumbPage>
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
  const tc = useTranslations("common");
  const td = useTranslations("dashboard");
  const projects = useQuery(api.projects.list);

  if (projects === undefined || projects === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-sm text-muted-foreground">{tc("loading")}</div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        title={td("noProjects")}
        description={td("noProjectsDescription")}
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
  tab,
  onTabChange,
}: {
  projectId: Id<"projects">;
  onDeleted: () => void;
  tab: "tasks" | "attachments";
  onTabChange: (tab: string) => void;
}) {
  const tc = useTranslations("common");
  const td = useTranslations("dashboard");
  const project = useQuery(api.projects.get, { id: projectId });

  if (project === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-sm text-muted-foreground">{tc("loading")}</div>
      </div>
    );
  }

  if (project === null) {
    return (
      <EmptyState
        title={td("projectNotFound")}
        description={td("projectNotFoundDescription")}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <ProjectHeader project={project} onDeleted={onDeleted} />
      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="tasks">{td("tabs.tasks")}</TabsTrigger>
          <TabsTrigger value="attachments">{td("tabs.attachments")}</TabsTrigger>
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
