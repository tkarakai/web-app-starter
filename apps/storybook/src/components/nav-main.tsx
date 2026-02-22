"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  useSidebar,
} from "@repo/design-system";

interface NavItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  items?: { title: string; url: string }[];
}

/** Highlights portions of `text` that match `query` (case-insensitive). */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);

  return (
    <>
      {before}
      <mark className="bg-primary/15 text-inherit rounded-sm">{match}</mark>
      {after}
    </>
  );
}

export function NavMain({ items, query = "", label = "Components" }: { items: NavItem[]; query?: string; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { state: sidebarState } = useSidebar();

  const isSearching = query.length > 0;

  // Track whether we've mounted to avoid hydration mismatches.
  // Radix Collapsible generates different IDs when controlled `open` prop
  // differs between server and client renders.
  const [mounted, setMounted] = useState(false);

  // Determine which category should be forced open based on the current route
  const activeCategory = items.find(
    (item) =>
      item.url === pathname ||
      item.items?.some((sub) => sub.url === pathname),
  );

  const [openSet, setOpenSet] = useState<Set<string>>(() => new Set());
  // Track categories the user explicitly collapsed so auto-expand doesn't
  // immediately reopen them on the same pathname change.
  const [userClosed, setUserClosed] = useState<Set<string>>(() => new Set());

  // After mount, sync open state with the current pathname
  useEffect(() => {
    setMounted(true);
    if (activeCategory) {
      setOpenSet(new Set([activeCategory.title]));
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expand the active category when pathname changes (after mount),
  // but only if the user hasn't explicitly collapsed it.
  useEffect(() => {
    if (!mounted) return;
    if (activeCategory && !openSet.has(activeCategory.title) && !userClosed.has(activeCategory.title)) {
      setOpenSet((prev) => new Set(prev).add(activeCategory.title));
    }
    // Clear the user-closed set on pathname change so that navigating
    // to a new route resets the override.
    setUserClosed(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleCategory = useCallback((title: string) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
        // Mark as user-closed so the pathname effect doesn't reopen it
        setUserClosed((prevClosed) => new Set(prevClosed).add(title));
      } else {
        next.add(title);
        // User opened it, remove from closed set
        setUserClosed((prevClosed) => {
          const nextClosed = new Set(prevClosed);
          nextClosed.delete(title);
          return nextClosed;
        });
      }
      return next;
    });
  }, []);

  // Filter items based on search query
  const filteredItems = useMemo((): NavItem[] => {
    if (!isSearching) return items;

    const q = query.toLowerCase();
    const results: NavItem[] = [];
    for (const item of items) {
      const matchingChildren = item.items?.filter((sub) =>
        sub.title.toLowerCase().includes(q),
      );
      // Show category if its name matches or any child matches
      if (item.title.toLowerCase().includes(q) || (matchingChildren && matchingChildren.length > 0)) {
        results.push({ ...item, items: matchingChildren });
      }
    }
    return results;
  }, [items, query, isSearching]);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {/* Navigation items */}
        {filteredItems.map((item) => {
          const isCategoryActive = item.title === activeCategory?.title;
          // When searching, force all matching categories open
          const isOpen = isSearching || openSet.has(item.title);

          // Before mount, render a static (non-Collapsible) version to avoid
          // Radix ID hydration mismatches. After mount, swap to the interactive
          // Collapsible which generates stable client-side IDs.
          if (!mounted) {
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isCategoryActive}
                  className={
                    isCategoryActive
                      ? "bg-sidebar-primary/10 font-semibold text-sidebar-primary"
                      : undefined
                  }
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                  <ChevronRight className="ml-auto" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          }

          return (
            <Collapsible
              key={item.title}
              asChild
              {...(isSearching
                ? { open: true }
                : { open: isOpen, onOpenChange: () => toggleCategory(item.title) }
              )}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isCategoryActive}
                    closeOnSelectMobile
                    className={
                      isCategoryActive
                        ? "bg-sidebar-primary/10 font-semibold text-sidebar-primary"
                        : undefined
                    }
                    onClick={() => router.push(item.url)}
                  >
                    {item.icon && <item.icon />}
                    <span><Highlight text={item.title} query={isSearching ? query : ""} /></span>
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
                            <span><Highlight text={subItem.title} query={isSearching ? query : ""} /></span>
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

        {/* No results message (hidden when sidebar is collapsed — no room) */}
        {isSearching && filteredItems.length === 0 && sidebarState !== "collapsed" && (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            No {label.toLowerCase()} found
          </li>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
