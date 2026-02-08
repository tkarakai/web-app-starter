"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@repo/design-system";

const options = [
  { value: "light", icon: Sun, label: "Light theme" },
  { value: "system", icon: Monitor, label: "System theme" },
  { value: "dark", icon: Moon, label: "Dark theme" },
] as const;

const themeOrder: string[] = options.map((o) => o.value);

interface ThemeToggleProps {
  className?: string;
  /** When true, renders as a single icon button that cycles through themes on click. */
  collapsed?: boolean;
}

export function ThemeToggle({ className, collapsed = false }: ThemeToggleProps) {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch: `theme` is undefined on the server,
  // so we only apply the active style after the first client render.
  useEffect(() => setMounted(true), []);

  if (collapsed) {
    const currentIndex = themeOrder.indexOf(theme ?? "system");
    const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length]!;
    const current = options.find((o) => o.value === (theme ?? "system")) ?? options[1];
    const CurrentIcon = current.icon;

    return (
      <button
        type="button"
        aria-label={`Theme: ${current.label}. Click to switch.`}
        onClick={() => setTheme(nextTheme)}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex h-9 aspect-square items-center justify-center rounded-md bg-muted text-muted-foreground transition-all duration-150 hover:text-foreground",
          className,
        )}
      >
        {mounted ? <CurrentIcon className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex h-9 items-center gap-1 rounded-md bg-muted p-1",
        className,
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          onClick={() => setTheme(value)}
          className={cn(
            "flex-1 h-full aspect-square flex items-center justify-center rounded-sm transition-all duration-150",
            mounted && theme === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
