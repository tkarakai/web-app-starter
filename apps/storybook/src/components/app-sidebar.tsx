"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Layers,
  MousePointerClick,
  Moon,
  PanelsTopLeft,
  ScanEye,
  Search,
  SquareMousePointer,
  Sun,
  TextCursorInput,
  X,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@repo/design-system";

import { NavMain } from "@/components/nav-main";
import { SidebarTitle } from "@/components/team-switcher";
import {
  type ComponentCategory,
  categoryOrder,
  categoryToSlug,
  getComponentsByCategory,
} from "@/lib/registry";

const categoryIcons: Record<ComponentCategory, LucideIcon> = {
  Actions: MousePointerClick,
  "Data Display": ScanEye,
  Feedback: SquareMousePointer,
  Form: TextCursorInput,
  Layout: PanelsTopLeft,
  Overlay: Layers,
};

const componentsByCategory = getComponentsByCategory();

const navItems = categoryOrder.map((category) => ({
  title: category,
  url: `/components/category/${categoryToSlug(category)}`,
  icon: categoryIcons[category],
  items: componentsByCategory[category].map((entry) => ({
    title: entry.name,
    url: `/components/${entry.slug}`,
  })),
}));

function SidebarSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const { state: sidebarState, setOpen } = useSidebar();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isSearching = query.length > 0;

  const handleSearchIconClick = () => {
    if (sidebarState === "collapsed") {
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 200);
    } else {
      inputRef.current?.focus();
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild={sidebarState !== "collapsed"}
          tooltip="Search components"
          className={sidebarState === "collapsed" ? "cursor-pointer" : "hover:bg-transparent active:bg-transparent p-0"}
          onClick={sidebarState === "collapsed" ? handleSearchIconClick : undefined}
        >
          {sidebarState === "collapsed" ? (
            <Search />
          ) : (
            <div className="relative flex w-full items-center">
              <Search className="pointer-events-none absolute left-2 h-4 w-4 text-muted-foreground" />
              <SidebarInput
                ref={inputRef}
                placeholder="Search..."
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                className="pl-8 pr-7"
              />
              {isSearching && (
                <button
                  type="button"
                  onClick={() => onQueryChange("")}
                  className="absolute right-1.5 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [isDark, setIsDark] = React.useState(false);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    setIsDark(next);
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarTitle />
        <SidebarSearch query={query} onQueryChange={setQuery} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} query={query} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleTheme} tooltip={isDark ? "Light mode" : "Dark mode"}>
              {isDark ? <Sun /> : <Moon />}
              <span>{isDark ? "Light mode" : "Dark mode"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
