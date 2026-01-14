"use client";

import { useState } from "react";
import { CheckCircle2, Database, Shield } from "lucide-react";
import { useMutation, useQuery } from "convex/react";

import { Button } from "@/components/ui/button";
import { FeatureCard } from "@/components/FeatureCard";
import { api } from "@/convex/_generated/api";

type Task = {
  _id: string;
  title: string;
  status: string;
};

export default function HomePage() {
  const tasks = (useQuery(api.tasks.list) ?? []) as Task[];
  const createTask = useMutation(api.tasks.create);
  const [newTask, setNewTask] = useState("");

  async function handleAddTask() {
    if (!newTask.trim()) {
      return;
    }

    await createTask({ title: newTask.trim() });
    setNewTask("");
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
      <section className="space-y-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">
          Web App Starter
        </p>
        <h1 className="text-4xl font-semibold text-slate-900">
          Build confidently with Next.js, Bun, Convex, and BetterAuth
        </h1>
        <p className="max-w-2xl text-base text-slate-600">
          This starter ships with a ready-to-go architecture: Tailwind styling,
          shadcn/ui primitives, Convex-backed APIs, and BetterAuth scaffolding.
          Extend the sample task workflow below to validate end-to-end flows.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <FeatureCard
          title="Convex-backed API"
          description="Query and mutate tasks in real time with Convex functions."
          icon={<Database className="h-5 w-5" />}
        />
        <FeatureCard
          title="BetterAuth-ready"
          description="Drop in OAuth providers and session handling with BetterAuth."
          icon={<Shield className="h-5 w-5" />}
        />
        <FeatureCard
          title="Shadcn UI"
          description="Build consistent interfaces with shared UI primitives."
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Sample task list
            </h2>
            <p className="text-sm text-slate-600">
              Add tasks to verify the Convex mutation + query pipeline.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:flex-row md:w-auto">
            <input
              value={newTask}
              onChange={(event) => setNewTask(event.target.value)}
              placeholder="Ship the starter app"
              className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <Button onClick={handleAddTask}>Add task</Button>
          </div>
        </div>
        <ul className="mt-6 space-y-3">
          {tasks.length === 0 ? (
            <li className="text-sm text-slate-500">
              No tasks yet. Add one above to confirm Convex works.
            </li>
          ) : (
            tasks.map((task) => (
              <li
                key={task._id}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm"
              >
                <span className="text-slate-700">{task.title}</span>
                <span className="text-xs text-slate-400">{task.status}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </main>
  );
}
