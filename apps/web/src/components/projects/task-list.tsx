"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@repo/backend";
import { type Id } from "@repo/backend";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
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
} from "@repo/design-system";
import { normalizeText, type TaskStatus } from "@/lib/projects";
import { TaskRow } from "./task-row";

type Task = {
  _id: Id<"tasks">;
  _creationTime: number;
  title: string;
  description: string;
  status: TaskStatus;
  projectId: Id<"projects">;
  ownerId: string;
  createdAt: number;
};

type TaskListProps = {
  projectId: Id<"projects">;
};

export function TaskList({ projectId }: TaskListProps) {
  const tasks: Task[] = useQuery(api.tasks.listByProject, { projectId }) ?? [];
  const createTask = useMutation(api.tasks.create);

  const [tab, setTab] = React.useState<"all" | TaskStatus>("all");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState<TaskStatus>("todo");
  const [submitting, setSubmitting] = React.useState(false);

  const filteredTasks = tasks.filter((t) => tab === "all" || t.status === tab);
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const progress = tasks.length === 0 ? 0 : Math.round((doneCount / tasks.length) * 100);

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
      });
      setTitle("");
      setDescription("");
      setStatus("todo");
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
            Tasks{tasks.length > 0 && ` (${tasks.length})`}
          </CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Add task
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New task</DialogTitle>
              </DialogHeader>
              <form className="space-y-4" onSubmit={handleCreate}>
                <div className="space-y-2">
                  <Label htmlFor="new-task-title">Title</Label>
                  <Input
                    id="new-task-title"
                    placeholder="What needs to be done?"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-task-description">Description</Label>
                  <Textarea
                    id="new-task-description"
                    placeholder="Add details..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-task-status">Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                    <SelectTrigger id="new-task-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">To do</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Creating..." : "Create task"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="todo">To do</TabsTrigger>
            <TabsTrigger value="in_progress">In progress</TabsTrigger>
            <TabsTrigger value="done">Done</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="space-y-4">
        {filteredTasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
            No tasks yet. Add one to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTasks.map((task) => (
              <TaskRow key={task._id} task={task} />
            ))}
          </div>
        )}

        {tasks.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {doneCount} of {tasks.length} tasks done
              </span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
