"use client";

import { useState } from "react";
import { business, dispatchQueue, loads } from "@/business/dispatch";

export function DispatchBoard() {
  const [dispatched, setDispatched] = useState<string[]>([]);
  const queue = dispatchQueue(loads).filter((load) => !dispatched.includes(load.reference));

  return (
    <section className="rounded-xl border bg-card p-6" aria-labelledby="dispatch-heading">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">West coast / Dispatch desk</p>
      <h1 id="dispatch-heading" className="mt-3 text-3xl font-semibold tracking-tight">{business.name}</h1>
      <p className="mt-2 text-muted-foreground">{business.description}</p>
      <div className="mt-8 flex items-baseline justify-between border-b pb-3">
        <h2 className="font-semibold">Ready loads</h2>
        <span className="font-mono text-sm" aria-live="polite">{queue.length} awaiting dispatch</span>
      </div>
      <ul className="divide-y">
        {queue.map((load) => (
          <li key={load.reference} className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div>
              <p className="font-mono text-xs text-muted-foreground">{load.reference} / {load.weightKg} kg</p>
              <p className="mt-1 font-medium">{load.destination}</p>
            </div>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => setDispatched((sent) => [...sent, load.reference])}>
              Dispatch {load.reference}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted-foreground" role="status">{dispatched.length} dispatched this session · Heavy freight first</p>
    </section>
  );
}
