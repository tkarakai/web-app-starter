"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Moon, Sun, X } from "lucide-react";
import { cn } from "@repo/ui";

import { useTheme } from "./theme-provider";
import {
  categoryOrder,
  getComponentsByCategory,
} from "@/lib/registry";

export function Sidebar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = React.useState(false);

  const grouped = getComponentsByCategory();

  const navContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5 text-foreground hover:text-primary transition-colors"
          onClick={() => setOpen(false)}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="text-sm font-bold">UI</span>
          </div>
          <div>
            <span className="block text-sm font-bold tracking-tight">Design System</span>
            <span className="block text-[10px] font-medium text-muted-foreground">@repo/ui</span>
          </div>
        </Link>
        <button
          onClick={toggleTheme}
          className="rounded-md p-2 hover:bg-muted transition-colors"
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          {theme === "light" ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {categoryOrder.map((category) => (
          <div key={category} className="mb-5">
            <h4 className="px-2 mb-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
              {category}
            </h4>
            <ul className="space-y-0.5">
              {grouped[category].map((entry) => {
                const href = `/components/${entry.slug}`;
                const isActive = pathname === href;
                return (
                  <li key={entry.slug}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "block rounded-md px-2 py-1.5 text-[13px] transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground/70 hover:text-foreground hover:bg-muted"
                      )}
                    >
                      {entry.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border px-5 py-4">
        <p className="text-[10px] font-medium text-muted-foreground">
          {grouped ? Object.values(grouped).flat().length : 0} components
        </p>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-50 rounded-md border border-border bg-card p-2 shadow-sm md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-border bg-background transition-transform duration-200 md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute right-3 top-6 rounded-md p-1 hover:bg-muted"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
        {navContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-[280px] md:flex-col md:fixed md:inset-y-0 md:left-0 md:border-r md:border-border md:bg-background">
        {navContent}
      </aside>
    </>
  );
}
