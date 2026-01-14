"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";

export function FileList() {
  const files = useQuery(api.files.list);

  if (!files) {
    return <p className="text-sm text-muted-foreground">Loading files…</p>;
  }

  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No files yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {files.map((file) => (
        <li key={file._id} className="rounded-md border border-border px-3 py-2">
          <div className="font-medium">{file.name}</div>
          <div className="text-xs text-muted-foreground">
            {Math.round(file.size / 1024)} KB · {file.type || "unknown"}
          </div>
        </li>
      ))}
    </ul>
  );
}
