"use client";

import * as React from "react";
import { ChevronRight, Trash2, UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";

import { type Id } from "@repo/backend";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web-app-starter/design-system";
import { usePersonalFiles } from "@/hooks/use-personal-data";
import type { PersonalDataPlane } from "@/hooks/personal-data-context";
import { formatBytes } from "@/lib/format";
import { PersonalDataNotReady } from "./personal-data-not-ready";

const MAX_FILE_SIZE = 1_048_576; // 1MB

type UploadPanelProps = {
  projectId: Id<"projects">;
  dataPlane: PersonalDataPlane;
  collapsible?: boolean;
};

export function UploadPanel({ projectId, dataPlane, collapsible = true }: UploadPanelProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(!collapsible);
  const t = useTranslations("uploads");

  const files = usePersonalFiles(projectId, dataPlane);
  const tErrors = useTranslations("errors.convex");
  const uploads = files.uploads ?? [];

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !files.available) return;

    if (file.size > MAX_FILE_SIZE) {
      setError(t("errors.tooLarge"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const request = files.capture();
      const bytes = await file.arrayBuffer();
      await request.upload({
        bytes,
        contentType: file.type || "application/octet-stream",
        name: file.name,
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch {
      setError(t("errors.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (id: Id<"uploads">) => {
    setError(null);
    try {
      const request = files.capture();
      const file = await request.download(id);
      const url = URL.createObjectURL(new Blob([file.bytes], { type: file.contentType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      // Allow the browser to consume the URL before releasing the local buffer.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(tErrors("serverError"));
    }
  };

  const handleDelete = async (id: Id<"uploads">) => {
    if (!files.available) return;
    await files.capture().remove(id);
  };

  const content = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
      />
      {error && (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {files.uploads === undefined ? <PersonalDataNotReady state={files.available || files.state === "loading" ? "loading" : "unavailable"} /> : uploads.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/70 bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          {t("emptyState")}
        </div>
      ) : (
        <div className="space-y-2">
          {uploads.map((upload) => (
            <div
              key={upload._id}
              className="group flex items-center justify-between rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium text-foreground">{upload.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(upload.size)} &middot; {upload.contentType}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="link"
                  size="sm"
                  disabled={!files.available || !upload.available}
                  onClick={() => handleDownload(upload._id)}
                >
                  {t("view")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  disabled={!files.available || !upload.available}
                  onClick={() => handleDelete(upload._id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">{t("deleteFile")}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (!collapsible) {
    return (
      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between p-4">
          <CardTitle className="text-sm font-medium">
            {t("title")}{uploads.length > 0 && ` (${uploads.length})`}
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !files.available}
          >
            <UploadCloud className="h-4 w-4" />
            {uploading ? t("uploading") : t("addFile")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {content}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row items-center justify-between p-4">
          <CollapsibleTrigger className="flex items-center gap-2 hover:opacity-80">
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
            />
            <CardTitle className="text-sm font-medium">
              {t("title")}{uploads.length > 0 && ` (${uploads.length})`}
            </CardTitle>
          </CollapsibleTrigger>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !files.available}
          >
            <UploadCloud className="h-4 w-4" />
            {uploading ? t("uploading") : t("addFile")}
          </Button>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0">
            {content}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
