"use client";

import * as React from "react";
import { ChevronRight, UploadCloud } from "lucide-react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@repo/backend";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/design-system";
import { formatBytes } from "@/lib/format";

export function UploadPanel() {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveUpload = useMutation(api.files.saveUpload);
  const uploads = useQuery(api.files.listUploads) ?? [];

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!result.ok) {
        throw new Error("Upload failed. Please try again.");
      }

      const { storageId } = await result.json();

      await saveUpload({
        storageId,
        name: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed."
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="border-border/60">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row items-center justify-between p-4">
          <CollapsibleTrigger className="flex items-center gap-2 hover:opacity-80">
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
            />
            <CardTitle className="text-sm font-medium">
              Attachments{uploads.length > 0 && ` (${uploads.length})`}
            </CardTitle>
          </CollapsibleTrigger>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <UploadCloud className="h-4 w-4" />
            {uploading ? "Uploading..." : "Add file"}
          </Button>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0">
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
            {uploads.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                Upload files to show the Convex file storage flow.
              </div>
            ) : (
              <div className="space-y-2">
                {uploads.map((upload) => (
                  <div
                    key={upload._id}
                    className="flex items-center justify-between rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium text-foreground">{upload.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatBytes(upload.size)} &middot; {upload.contentType}
                      </div>
                    </div>
                    {upload.url ? (
                      <a
                        href={upload.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-primary underline"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">Processing</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
