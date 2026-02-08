"use client";

import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import {
  BreadcrumbItem,
  BreadcrumbSeparator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/design-system";

interface BreadcrumbSibling {
  label: string;
  href: string;
}

interface BreadcrumbDropdownItemProps {
  /** Text displayed in the breadcrumb */
  label: string;
  /** URL this breadcrumb navigates to */
  href: string;
  /** Whether this is the final (current page) segment */
  isCurrentPage?: boolean;
  /** Sibling items shown in the dropdown */
  siblings: BreadcrumbSibling[];
  /** The href of the currently active sibling (highlighted in dropdown) */
  activeHref: string;
  /** Hide on smaller viewports (matches existing hidden md:block pattern) */
  hiddenOnMobile?: boolean;
  /** Show a separator after this breadcrumb item */
  showSeparator?: boolean;
}

export function BreadcrumbDropdownItem({
  label,
  href: _href,
  isCurrentPage = false,
  siblings,
  activeHref,
  hiddenOnMobile = false,
  showSeparator = false,
}: BreadcrumbDropdownItemProps) {
  const hiddenClass = hiddenOnMobile ? "hidden md:flex" : "";

  return (
    <>
      <BreadcrumbItem className={hiddenClass || undefined}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={`flex items-center gap-1 outline-none transition-colors ${
              isCurrentPage
                ? "font-normal text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {siblings.map((sibling) => {
              const isActive = sibling.href === activeHref;
              return (
                <DropdownMenuItem key={sibling.href} asChild>
                  <Link
                    href={sibling.href}
                    className={`pr-6 ${isActive ? "font-semibold" : ""}`}
                  >
                    {isActive ? (
                      <Check className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <span className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    {sibling.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </BreadcrumbItem>
      {showSeparator && (
        <BreadcrumbSeparator className={hiddenClass || undefined} />
      )}
    </>
  );
}
