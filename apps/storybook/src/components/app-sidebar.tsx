"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Layers,
  MousePointerClick,
  Moon,
  PanelsTopLeft,
  ScanEye,
  SquareMousePointer,
  Sun,
  TextCursorInput,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [isDark, setIsDark] = React.useState(false);

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
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} />
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
