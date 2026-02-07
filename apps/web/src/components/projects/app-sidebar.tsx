"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderKanban, LogOut, Plus } from "lucide-react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@repo/backend";
import { type Id } from "@repo/backend";
import { authClient } from "@repo/auth/client";
import {
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  Textarea,
  useSidebar,
} from "@repo/design-system";
import { normalizeText } from "@/lib/projects";

type Project = {
  _id: Id<"projects">;
  _creationTime: number;
  name: string;
  description: string;
  ownerId: string;
  createdAt: number;
};

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  displayName: string;
  displayEmail?: string;
  selectedProjectId: Id<"projects"> | null;
  onSelectProject: (id: Id<"projects">) => void;
};

export function AppSidebar({
  displayName,
  displayEmail,
  selectedProjectId,
  onSelectProject,
  ...props
}: AppSidebarProps) {
  const router = useRouter();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const projects: Project[] = useQuery(api.projects.list) ?? [];
  const createProject = useMutation(api.projects.create);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = normalizeText(name);
    if (!trimmedName) return;

    setSubmitting(true);
    try {
      const id = await createProject({
        name: trimmedName,
        description: normalizeText(description),
      });
      setName("");
      setDescription("");
      setDialogOpen(false);
      onSelectProject(id);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = () => {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => router.push("/"),
      },
    });
  };

  return (
    <>
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Projects" className="font-semibold">
                <FolderKanban className="h-4 w-4" />
                <span>Projects</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction onClick={() => setDialogOpen(true)} title="New project">
              <Plus className="h-4 w-4" />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {projects.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className="text-muted-foreground italic"
                      onClick={() => setDialogOpen(true)}
                      tooltip="Create your first project"
                    >
                      <span>No projects</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  projects.map((project) => (
                    <SidebarMenuItem key={project._id}>
                      <SidebarMenuButton
                        isActive={project._id === selectedProjectId}
                        onClick={() => onSelectProject(project._id)}
                        tooltip={project.name}
                      >
                        <span className="truncate">{project.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    tooltip={displayName}
                    className="h-auto py-2"
                  >
                    <Avatar className="h-7 w-7 shrink-0 border border-border/60">
                      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    {!isCollapsed && (
                      <div className="flex flex-col items-start overflow-hidden">
                        <span className="truncate text-sm font-medium">{displayName}</span>
                        {displayEmail && (
                          <span className="truncate text-xs text-muted-foreground">
                            {displayEmail}
                          </span>
                        )}
                      </div>
                    )}
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-48">
                  <DropdownMenuItem onSelect={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="space-y-2">
              <Label htmlFor="new-project-name">Name</Label>
              <Input
                id="new-project-name"
                placeholder="Project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-project-description">Description</Label>
              <Textarea
                id="new-project-description"
                placeholder="What is this project about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating..." : "Create project"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
