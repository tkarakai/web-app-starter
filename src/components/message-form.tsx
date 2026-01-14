"use client";

import { useState } from "react";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

export function MessageForm() {
  const addMessage = useMutation(api.messages.add);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!author.trim() || !body.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await addMessage({ author, body });
      setBody("");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="author">
          Your name
        </label>
        <input
          id="author"
          name="author"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          placeholder="Ada Lovelace"
          autoComplete="name"
          required
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="min-h-[96px] rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Share a quick update…"
          required
        />
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending…" : "Post message"}
      </Button>
    </form>
  );
}
