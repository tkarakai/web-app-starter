"use client";

import { useState } from "react";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

export function FileUpload() {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveFile = useMutation(api.files.saveFile);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsUploading(true);
    setMessage(null);

    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file
      });
      const { storageId } = await response.json();
      await saveFile({
        storageId,
        name: file.name,
        type: file.type,
        size: file.size
      });
      setMessage("File uploaded to Convex storage.");
    } catch (error) {
      console.error(error);
      setMessage("Upload failed. Check your Convex configuration.");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium" htmlFor="file-upload">
          Upload a file
        </label>
        <input
          id="file-upload"
          type="file"
          onChange={handleFileChange}
          className="mt-2 block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground"
          disabled={isUploading}
        />
      </div>
      <Button type="button" variant="outline" disabled={isUploading}>
        {isUploading ? "Uploading…" : "Ready to upload"}
      </Button>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
