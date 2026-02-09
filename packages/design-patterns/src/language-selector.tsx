"use client";

import { Check } from "lucide-react";

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/design-system";

interface LocaleOption {
  code: string;
  nativeName: string;
  flag: string;
}

interface LanguageSelectorProps {
  /** The currently active locale code (e.g. "en"). */
  currentLocale: string;
  /** Available locale options to display. */
  locales: LocaleOption[];
  /** Called when the user selects a locale. The consumer handles navigation. */
  onSelect: (locale: string) => void;
  /** Accessible label for the dropdown trigger. */
  ariaLabel?: string;
  className?: string;
  /**
   * "standalone" (default): renders a full DropdownMenu with trigger button.
   * "submenu": renders DropdownMenuSub for embedding inside an existing DropdownMenu.
   */
  variant?: "standalone" | "submenu";
}

function LocaleItems({
  currentLocale,
  locales,
  onSelect,
}: {
  currentLocale: string;
  locales: LocaleOption[];
  onSelect: (locale: string) => void;
}) {
  return (
    <>
      {locales.map((locale) => {
        const isSelected = locale.code === currentLocale;
        return (
          <DropdownMenuItem
            key={locale.code}
            onSelect={() => onSelect(locale.code)}
            className="justify-between pe-3"
          >
            <span className="flex items-center">
              <span className="me-2">{locale.flag}</span>
              {locale.nativeName}
            </span>
            {isSelected && <Check className="h-4 w-4 shrink-0 text-foreground" />}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

export function LanguageSelector({
  currentLocale,
  locales,
  onSelect,
  ariaLabel = "Select language",
  className,
  variant = "standalone",
}: LanguageSelectorProps) {
  const current = locales.find((l) => l.code === currentLocale);

  if (locales.length <= 1) {
    return null;
  }

  if (variant === "submenu") {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={className}>
          <span className="me-2">{current?.flag}</span>
          {current?.nativeName}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          className="p-0"
          style={{ maxHeight: "var(--radix-popper-available-height, 80vh)", overflowY: "auto" }}
        >
          <div className="p-1">
            <LocaleItems
              currentLocale={currentLocale}
              locales={locales}
              onSelect={onSelect}
            />
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-9 items-center rounded-md border border-border/60 bg-background px-3 text-sm font-medium text-foreground transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "cursor-pointer",
          className,
        )}
      >
        <span className="flex items-center">
          <span className="me-2">{current?.flag}</span>
          {current?.nativeName}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="p-0"
        style={{ maxHeight: "var(--radix-popper-available-height, 80vh)", overflowY: "auto" }}
      >
        <div className="p-1">
          <LocaleItems
            currentLocale={currentLocale}
            locales={locales}
            onSelect={onSelect}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
