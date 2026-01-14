"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";

export function MessageBoard() {
  const messages = useQuery(api.messages.list as any);
  const createMessage = useMutation(api.messages.create as any);
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState("Starter User");

  const isDisabled = body.trim().length === 0;

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Sample Convex Workflow
        </p>
        <h2 className="text-2xl font-semibold text-slate-900">Message board</h2>
        <p className="text-sm text-slate-600">
          This widget stores the latest messages in Convex. Update the schema and
          queries in <code className="rounded bg-slate-100 px-1">convex/</code> as your
          product evolves.
        </p>
      </header>

      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          await createMessage({ body, author });
          setBody("");
        }}
      >
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Author
          <input
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            placeholder="Your name"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Message
          <textarea
            className="min-h-[96px] rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Say hello to your future users..."
          />
        </label>
        <Button type="submit" disabled={isDisabled}>
          Send message
        </Button>
      </form>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Latest messages
        </h3>
        <ul className="space-y-2">
          {messages?.length ? (
            messages.map((message) => (
              <li
                key={message._id}
                className="rounded-lg border border-slate-100 bg-slate-50 p-3"
              >
                <p className="text-sm font-semibold text-slate-800">
                  {message.author}
                </p>
                <p className="text-sm text-slate-700">{message.body}</p>
              </li>
            ))
          ) : (
            <li className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              No messages yet. Add one to see Convex in action.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
