"use client";

import { DialogContent } from "@/components/ui/localized-controls";

import * as React from "react";
import { Plus } from "lucide-react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";

import { api } from "@repo/backend";
import { type Id } from "@repo/backend";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@web-app-starter/design-system";
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast";
import { normalizeText, type TaskStatus } from "@/lib/projects";
import { DeadlineInput } from "./deadline-input";
import { TaskRow } from "./task-row";

type Task = {
  _id: Id<"tasks">;
  _creationTime: number;
  title: string;
  description: string;
  status: TaskStatus;
  deadline?: number;
  projectId: Id<"projects">;
  ownerId: string;
  createdAt: number;
};

/** Tasks listed per page. Counts stop at `MAX_COUNTED` (the backend's), shown as "99+". */
const TASKS_PAGE = 50;
const MAX_COUNTED = 99;

type TaskListProps = {
  projectId: Id<"projects">;
};

export function TaskList({ projectId }: TaskListProps) {
  const [tab, setTab] = React.useState<"all" | TaskStatus>("all");
  // The tab filters on the server, so every page holds tasks of that status.
  const taskPages = usePaginatedQuery(api.tasks.listByProject, { projectId, ...(tab === "all" ? {} : { status: tab }) }, { initialNumItems: TASKS_PAGE });
  const tasks: Task[] = taskPages.results;
  const stats = useQuery(api.tasks.stats, { projectId });
  const profile = useQuery(api.platform.userProfiles.get);
  const createTask = useMutationWithToast(api.tasks.create);
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const locale = useLocale();

  const timeZone = profile?.timezone ?? undefined;

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState<TaskStatus>("todo");
  const [deadline, setDeadline] = React.useState<number | undefined>(undefined);
  const [submitting, setSubmitting] = React.useState(false);

  const taskCount = stats?.taskCount ?? 0;
  const doneCount = stats?.doneCount ?? 0;
  const capped = stats?.countsCapped ?? false;
  const shown = (count: number) => (capped && count >= MAX_COUNTED ? `${MAX_COUNTED}+` : count);
  const progress = taskCount === 0 ? 0 : Math.round((doneCount / taskCount) * 100);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = normalizeText(title);
    if (!trimmedTitle) return;

    setSubmitting(true);
    try {
      await createTask({
        title: trimmedTitle,
        description: normalizeText(description),
        status,
        projectId,
        deadline,
      });
      setTitle("");
      setDescription("");
      setStatus("todo");
      setDeadline(undefined);
      setDialogOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {t("title")}{taskCount > 0 && ` (${shown(taskCount)})`}
          </CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                {t("addTask")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("newTask")}</DialogTitle>
              </DialogHeader>
              <form className="space-y-4" onSubmit={handleCreate}>
                <div className="space-y-2">
                  <Label htmlFor="new-task-title">{t("fields.title")}</Label>
                  <Input
                    id="new-task-title"
                    placeholder={t("fields.titlePlaceholder")}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-task-description">{t("fields.description")}</Label>
                  <Textarea
                    id="new-task-description"
                    placeholder={t("fields.descriptionPlaceholder")}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-task-status">{t("status.label")}</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                    <SelectTrigger id="new-task-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">{t("status.todo")}</SelectItem>
                      <SelectItem value="in_progress">{t("status.inProgress")}</SelectItem>
                      <SelectItem value="done">{t("status.done")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DeadlineInput value={deadline} onChange={setDeadline} timeZone={timeZone} />
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? tc("creating") : t("createTask")}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">{t("status.all")}</TabsTrigger>
            <TabsTrigger value="todo">{t("status.todo")}</TabsTrigger>
            <TabsTrigger value="in_progress">{t("status.inProgress")}</TabsTrigger>
            <TabsTrigger value="done">{t("status.done")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="space-y-4">
        {taskCount > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t("progress", { doneCount: shown(doneCount), totalCount: shown(taskCount) })}
              </span>
              {!capped && <span>{t("progressPercent", { percent: progress })}</span>}
            </div>
            {!capped && <Progress value={progress} />}
          </div>
        )}

        {taskPages.status === "LoadingFirstPage" ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">{tc("loading")}</div>
        ) : tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
            {t("noTasks")}
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <TaskRow key={task._id} task={task} locale={locale} timeZone={timeZone} />
            ))}
          </div>
        )}
        {taskPages.status === "CanLoadMore" && (
          <Button variant="outline" size="sm" onClick={() => taskPages.loadMore(TASKS_PAGE)}>{tc("loadMore")}</Button>
        )}
      </CardContent>
    </Card>
  );
}
