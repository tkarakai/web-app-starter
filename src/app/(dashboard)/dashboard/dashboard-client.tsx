"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { usePreloadedAuthQuery } from "@convex-dev/better-auth/nextjs/client";
import { Preloaded } from "convex/react";
import {
  ArrowRight,
  Flame,
  Orbit,
  Sparkles,
  UserCircle2,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import {
  normalizeTitle,
  toPriorityLabel,
  launchStatuses,
  type LaunchStatus,
} from "@/lib/launchpad";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LaunchItemCard, type LaunchItem } from "@/components/launchpad/launch-item-card";
import { UploadPanel } from "@/components/launchpad/upload-panel";

type FormState = {
  title: string;
  description: string;
  status: LaunchStatus;
  priority: string;
};

const defaultFormState: FormState = {
  title: "",
  description: "",
  status: "idea",
  priority: "3",
};

type DashboardClientProps = {
  preloadedUser: Preloaded<typeof api.auth.getCurrentUser>;
};

export function DashboardClient({ preloadedUser }: DashboardClientProps) {
  const router = useRouter();
  const user = usePreloadedAuthQuery(preloadedUser);
  const session = authClient.useSession();
  const items = useQuery(api.launchItems.list) ?? [];
  const createLaunchItem = useMutation(api.launchItems.create);
  const updateLaunchItem = useMutation(api.launchItems.update);

  const [tab, setTab] = React.useState<"all" | "idea" | "building" | "shipping">("all");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<LaunchItem | null>(null);
  const [formState, setFormState] = React.useState<FormState>(defaultFormState);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const displayName = user?.name ?? session.data?.user?.name ?? "Anonymous";
  const displayEmail = user?.email ?? session.data?.user?.email;

  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const filteredItems = items.filter((item) => (tab === "all" ? true : item.status === tab));
  const shipped = items.filter((item) => item.status === "shipping").length;
  const progress = items.length === 0 ? 0 : Math.round((shipped / items.length) * 100);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const title = normalizeTitle(formState.title);
    if (!title) {
      setError("Title is required.");
      return;
    }

    setSubmitting(true);
    try {
      await createLaunchItem({
        title,
        description: normalizeTitle(formState.description),
        status: formState.status,
        priority: Number(formState.priority),
      });
      setFormState(defaultFormState);
      setDialogOpen(false);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Could not create item."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (item: LaunchItem) => {
    setEditingItem(item);
    setFormState({
      title: item.title,
      description: item.description,
      status: item.status,
      priority: String(item.priority),
    });
    setError(null);
    setEditDialogOpen(true);
  };

  const handleUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!editingItem) return;

    const title = normalizeTitle(formState.title);
    if (!title) {
      setError("Title is required.");
      return;
    }

    setSubmitting(true);
    try {
      await updateLaunchItem({
        id: editingItem._id,
        title,
        description: normalizeTitle(formState.description),
        status: formState.status,
        priority: Number(formState.priority),
      });
      setFormState(defaultFormState);
      setEditingItem(null);
      setEditDialogOpen(false);
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "Could not update item."
      );
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
    <TooltipProvider>
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(248,183,148,0.55),_rgba(255,255,255,0.1)_45%,_transparent_75%)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pb-24 pt-12">
          <header className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <Orbit className="h-4 w-4" />
                Launchpad control
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground">
                Ship smarter, not louder.
              </h1>
              <p className="max-w-xl text-sm text-muted-foreground">
                This dashboard runs entirely on Convex queries/mutations, Better Auth
                sessions, and Bun-powered Next.js. Everything here is ready to extend.
              </p>
            </div>
            <Card className="flex w-full max-w-sm items-center justify-between gap-4 border-border/60 bg-card/80 p-4 lg:w-auto">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 border border-border/60">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Signed in as</div>
                <div className="text-sm font-semibold text-foreground">
                  {displayName}
                </div>
                  <div className="text-xs text-muted-foreground">{displayEmail}</div>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <UserCircle2 className="h-4 w-4" />
                    Account
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      handleSignOut();
                    }}
                  >
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Card>
          </header>

          <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <Card className="border-border/60 bg-card/80">
              <CardHeader className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Launch signals</CardTitle>
                    <CardDescription>
                      Keep the pulse of every release milestone with Convex realtime
                      queries.
                    </CardDescription>
                  </div>
                  <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        New launch item
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Stage a new launch item</DialogTitle>
                      </DialogHeader>
                      <form className="space-y-4" onSubmit={handleCreate}>
                        <div className="space-y-2">
                          <Label htmlFor="title">Title</Label>
                          <Input
                            id="title"
                            name="title"
                            placeholder="Polish onboarding microcopy"
                            value={formState.title}
                            onChange={(event) =>
                              setFormState((prev) => ({
                                ...prev,
                                title: event.target.value,
                              }))
                            }
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="description">Description</Label>
                          <Textarea
                            id="description"
                            name="description"
                            placeholder="Quick context for the build team."
                            value={formState.description}
                            onChange={(event) =>
                              setFormState((prev) => ({
                                ...prev,
                                description: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="status">Status</Label>
                            <select
                              id="status"
                              name="status"
                              className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
                              value={formState.status}
                              onChange={(event) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  status: event.target.value as LaunchStatus,
                                }))
                              }
                            >
                              {launchStatuses.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="priority">Priority</Label>
                            <select
                              id="priority"
                              name="priority"
                              className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
                              value={formState.priority}
                              onChange={(event) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  priority: event.target.value,
                                }))
                              }
                            >
                              {[4, 3, 2, 1].map((level) => (
                                <option key={level} value={level}>
                                  {toPriorityLabel(level)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        {error ? (
                          <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                            {error}
                          </div>
                        ) : null}
                        <Button type="submit" className="w-full" disabled={submitting}>
                          {submitting ? "Saving" : "Add item"}
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
                <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
                  <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    {launchStatuses.map((status) => (
                      <TabsTrigger key={status} value={status}>
                        {status}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent className="space-y-4">
                {filteredItems.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/70 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
                    Nothing here yet. Add your first launch item to see Convex realtime
                    updates in action.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredItems.map((item) => (
                      <LaunchItemCard key={item._id} item={item} onEdit={handleEdit} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit launch item</DialogTitle>
                </DialogHeader>
                <form className="space-y-4" onSubmit={handleUpdate}>
                  <div className="space-y-2">
                    <Label htmlFor="edit-title">Title</Label>
                    <Input
                      id="edit-title"
                      name="title"
                      placeholder="Polish onboarding microcopy"
                      value={formState.title}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-description">Description</Label>
                    <Textarea
                      id="edit-description"
                      name="description"
                      placeholder="Quick context for the build team."
                      value={formState.description}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="edit-status">Status</Label>
                      <select
                        id="edit-status"
                        name="status"
                        className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
                        value={formState.status}
                        onChange={(event) =>
                          setFormState((prev) => ({
                            ...prev,
                            status: event.target.value as LaunchStatus,
                          }))
                        }
                      >
                        {launchStatuses.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-priority">Priority</Label>
                      <select
                        id="edit-priority"
                        name="priority"
                        className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
                        value={formState.priority}
                        onChange={(event) =>
                          setFormState((prev) => ({
                            ...prev,
                            priority: event.target.value,
                          }))
                        }
                      >
                        {[4, 3, 2, 1].map((level) => (
                          <option key={level} value={level}>
                            {toPriorityLabel(level)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {error ? (
                    <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                      {error}
                    </div>
                  ) : null}
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? "Saving" : "Update item"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>

            <div className="space-y-6">
              <Card className="border-border/60 bg-card/80">
                <CardHeader className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <Sparkles className="h-4 w-4" />
                    Release momentum
                  </div>
                  <CardTitle className="text-3xl font-semibold">
                    {progress}% ready to ship
                  </CardTitle>
                  <CardDescription>
                    Convex queries stream updates, so this number stays live.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Progress value={progress} />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{items.length} total items</Badge>
                    <Badge variant="accent">{shipped} shipping</Badge>
                    <Badge variant="outline">{items.length - shipped} remaining</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/80">
                <CardHeader className="space-y-2">
                  <CardTitle className="text-base">Signal helpers</CardTitle>
                  <CardDescription>
                    Quick utilities to show auth + API availability.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Convex connection</span>
                    <Badge variant={session.error ? "secondary" : "default"}>
                      {session.error ? "Needs auth" : "Live"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Active session</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline">
                          {session.data?.user?.email ? "Yes" : "No"}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {session.data?.user?.email
                          ? `Signed in as ${session.data.user.email}`
                          : "Sign in to enable realtime queries."}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Flame className="h-4 w-4" />
                    Everything here is powered by Convex queries + Better Auth sessions.
                  </div>
                </CardContent>
              </Card>

              <UploadPanel />
            </div>
          </section>
        </div>
      </main>
    </TooltipProvider>
  );
}
