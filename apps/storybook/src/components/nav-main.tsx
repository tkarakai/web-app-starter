"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@repo/ui";

interface NavItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  items?: { title: string; url: string }[];
}

export function NavMain({ items }: { items: NavItem[] }) {
  const router = useRouter();
  const pathname = usePathname();

  // Determine which category should be forced open based on the current route
  const activeCategory = items.find(
    (item) =>
      item.url === pathname ||
      item.items?.some((sub) => sub.url === pathname),
  );

  const [openSet, setOpenSet] = useState<Set<string>>(() => {
    return activeCategory ? new Set([activeCategory.title]) : new Set();
  });

  // Auto-expand the active category when pathname changes
  useEffect(() => {
    if (activeCategory && !openSet.has(activeCategory.title)) {
      setOpenSet((prev) => new Set(prev).add(activeCategory.title));
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCategory = useCallback((title: string) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }, []);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Components</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const isCategoryActive = item === activeCategory;

          return (
            <Collapsible
              key={item.title}
              asChild
              open={openSet.has(item.title)}
              onOpenChange={() => toggleCategory(item.title)}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isCategoryActive}
                    className={
                      isCategoryActive
                        ? "bg-sidebar-primary/10 font-semibold text-sidebar-primary"
                        : undefined
                    }
                    onClick={() => router.push(item.url)}
                  >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={subItem.url === pathname}
                          className={
                            subItem.url === pathname
                              ? "bg-sidebar-primary/10 font-semibold text-sidebar-primary"
                              : undefined
                          }
                        >
                          <Link href={subItem.url}>
                            <span>{subItem.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
