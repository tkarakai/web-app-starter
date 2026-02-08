"use client";

import * as React from "react";
import { Circle, CircleCheck, CircleDashed, Pencil, Trash2 } from "lucide-react";
import { useMutation } from "convex/react";

import { api } from "@repo/backend";
import { type Id } from "@repo/backend";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@repo/design-system";
import { toStatusLabel, type TaskStatus } from "@/lib/projects";
import { normalizeText } from "@/lib/projects";

type Task = {
  _id: Id<"tasks">;
  title: string;
  description: string;
  status: TaskStatus;
  projectId: Id<"projects">;
  createdAt: number;
};

const statusVariant: Record<TaskStatus, "secondary" | "default" | "outline"> = {
  todo: "outline",
  in_progress: "secondary",
  done: "default",
};

const statusCycle: Record<TaskStatus, TaskStatus> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  switch (status) {
    case "todo":
      return <Circle className={className} />;
    case "in_progress":
      return <CircleDashed className={`${className} text-primary`} />;
    case "done":
      return <CircleCheck className={`${className} text-primary`} />;
  }
}

type TaskRowProps = {
  task: Task;
};

export function TaskRow({ task }: TaskRowProps) {
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);

  const [editOpen, setEditOpen] = React.useState(false);
  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description);
  const [status, setStatus] = React.useState<TaskStatus>(task.status);
  const [submitting, setSubmitting] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setStatus(task.status);
  }, [task.title, task.description, task.status]);

  // Auto-revert the confirm state after 2 seconds
  React.useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 2000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const handleToggleStatus = async () => {
    await updateTask({ id: task._id, status: statusCycle[task.status] });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = normalizeText(title);
    if (!trimmedTitle) return;

    setSubmitting(true);
    try {
      await updateTask({
        id: task._id,
        title: trimmedTitle,
        description: normalizeText(description),
        status,
      });
      setEditOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await removeTask({ id: task._id });
  };

  const isDone = task.status === "done";

  return (
    <>
      <div className="group flex items-start gap-3 rounded-lg border border-border/60 bg-card/50 px-4 py-3 transition-colors hover:bg-card/80">
        <button
          type="button"
          onClick={handleToggleStatus}
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Change status from ${toStatusLabel(task.status)}`}
        >
          <StatusIcon status={task.status} className="h-5 w-5" />
        </button>

        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}>
            {task.title}
          </div>
          {task.description && (
            <div className="mt-0.5 text-xs text-muted-foreground truncate">
              {task.description}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={statusVariant[task.status]} className="text-xs">
            {toStatusLabel(task.status)}
          </Badge>
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="sr-only">Edit task</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 w-7 p-0 ${confirming ? "text-destructive opacity-100" : "text-muted-foreground hover:text-destructive"}`}
              onClick={handleDeleteClick}
            >
              {confirming ? (
                <CircleCheck className="h-4.5 w-4.5 fill-destructive text-destructive-foreground" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">{confirming ? "Confirm delete" : "Delete task"}</span>
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleUpdate}>
            <div className="space-y-2">
              <Label htmlFor="edit-task-title">Title</Label>
              <Input
                id="edit-task-title"
                placeholder="What needs to be done?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-task-description">Description</Label>
              <Textarea
                id="edit-task-description"
                placeholder="Add details..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-task-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger id="edit-task-status">
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
              {submitting ? "Saving..." : "Save changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
