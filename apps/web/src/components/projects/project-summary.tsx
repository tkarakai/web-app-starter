"use client";

import { Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";

import { type Id } from "@repo/backend";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
} from "@web-app-starter/design-system";

/** Counts stop at this many (the backend's `MAX_COUNTED`); `countsCapped` shows them as "99+". */
const MAX_COUNTED = 99;

/** A project with its counts, as `api.projects.listWithStats` returns it. */
export type ProjectWithStats = {
  _id: Id<"projects">;
  name: string;
  description: string;
  taskCount: number;
  doneCount: number;
  uploadCount: number;
  countsCapped: boolean;
};

type ProjectSummaryProps = {
  projects: ProjectWithStats[];
  onSelectProject: (id: Id<"projects">) => void;
};

export function ProjectSummary({ projects, onSelectProject }: ProjectSummaryProps) {
  const t = useTranslations("tasks");
  const tu = useTranslations("uploads");

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const progress =
          project.taskCount === 0
            ? 0
            : Math.round((project.doneCount / project.taskCount) * 100);
        const shown = (count: number) => (project.countsCapped && count >= MAX_COUNTED ? `${MAX_COUNTED}+` : count);

        return (
          <Card
            key={project._id}
            className="cursor-pointer border-border/60 transition-colors hover:bg-accent/50"
            onClick={() => onSelectProject(project._id)}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{project.name}</CardTitle>
              {project.description && (
                <CardDescription className="line-clamp-2 text-xs">
                  {project.description}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {project.taskCount > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {t("progress", { doneCount: shown(project.doneCount), totalCount: shown(project.taskCount) })}
                    </span>
                    {!project.countsCapped && <span>{t("progressPercent", { percent: progress })}</span>}
                  </div>
                  {!project.countsCapped && <Progress value={progress} className="h-1.5" />}
                </div>
              )}
              {project.taskCount === 0 && (
                <p className="text-xs text-muted-foreground">{t("noTasksSummary")}</p>
              )}
              {project.uploadCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  <Paperclip className="me-1 h-3 w-3" />
                  {project.countsCapped && project.uploadCount >= MAX_COUNTED ? shown(project.uploadCount) : tu("count", { count: project.uploadCount })}
                </Badge>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
