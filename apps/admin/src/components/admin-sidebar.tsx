"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ListChecks, LogOut, ScrollText, Users } from "lucide-react";

import { ThemeToggle } from "@repo/design-patterns";
import { authClient } from "@repo/auth/client";
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@repo/design-system";

type AdminSidebarProps = React.ComponentProps<typeof Sidebar> & {
  displayName: string;
  displayEmail?: string;
};

const navItems = [
  { label: "Users", href: "/dashboard/users", icon: Users },
  { label: "Waitlist", href: "/dashboard/waitlist", icon: ListChecks },
  { label: "Audit Trail", href: "/dashboard/audit-trail", icon: ScrollText },
];

export function AdminSidebar({
  displayName,
  displayEmail,
  ...props
}: AdminSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleSignOut = () => {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => router.push("/sign-in"),
      },
    });
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Admin" className="font-semibold">
              <img src="/icon.svg" alt="App Icon" className="h-5 w-5 shrink-0" />
              <span>Admin</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(item.href)}
                    tooltip={item.label}
                  >
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  tooltip={displayName}
                  className="h-auto py-2"
                >
                  <Avatar className="h-7 w-7 shrink-0 border border-border/60">
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  {!isCollapsed && (
                    <div className="flex flex-col items-start overflow-hidden">
                      <span className="truncate text-sm font-medium">{displayName}</span>
                      {displayEmail && (
                        <span className="truncate text-xs text-muted-foreground">
                          {displayEmail}
                        </span>
                      )}
                    </div>
                  )}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-48">
                <ThemeToggle className="mx-1 my-1" />
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleSignOut} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        <p className="text-xs text-muted-foreground text-center py-1">v0.0.1</p>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
