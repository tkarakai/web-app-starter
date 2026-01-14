"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { formatMessageLabel } from "@/lib/format";

export function MessageList() {
  const messages = useQuery(api.messages.list);

  if (!messages) {
    return <p className="text-sm text-muted-foreground">Loading messages…</p>;
  }

  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">No messages yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {messages.map((message) => (
        <li
          key={message._id}
          className="rounded-lg border border-border bg-card px-4 py-3 text-sm"
        >
          <span className="font-medium">
            {formatMessageLabel(message.author, message.body)}
          </span>
        </li>
      ))}
    </ul>
  );
}
