"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  ListChecks,
  LogOut,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";

import { ThemeToggle } from "@repo/design-patterns";
import { authClient } from "@repo/auth/client";
import {
  Avatar,
  AvatarFallback,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
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

const manageItems = [
  { label: "Waitlist", href: "/dashboard/waitlist", icon: ListChecks },
  { label: "Users", href: "/dashboard/users", icon: Users },
];

const observabilityItems = [
  { label: "Audit Trail", href: "/dashboard/audit-trail", icon: ScrollText },
];

const configureItems = [
  { label: "Features", href: "/dashboard/features", icon: SlidersHorizontal },
  { label: "Security", href: "/dashboard/security", icon: ShieldCheck },
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
  const sectionItemsIndentClass = "ps-3 group-data-[collapsible=icon]:ps-0";
  const [manageOpen, setManageOpen] = React.useState(true);
  const [observabilityOpen, setObservabilityOpen] = React.useState(true);
  const [configureOpen, setConfigureOpen] = React.useState(true);

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

  const isItemActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Web App Starter Admin" className="font-semibold">
              <img src="/icon.svg" alt="App Icon" className="h-5 w-5 shrink-0" />
              <span>Web App Starter Admin</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <Collapsible
            open={configureOpen}
            onOpenChange={setConfigureOpen}
            className="group/configure"
          >
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer">
                <ChevronRight className="mr-1 h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]/configure:rotate-90" />
                Configure
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent className={sectionItemsIndentClass}>
                <SidebarMenu>
                  {configureItems.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isItemActive(item.href)}
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
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>

        <SidebarGroup>
          <Collapsible open={manageOpen} onOpenChange={setManageOpen} className="group/manage">
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer">
                <ChevronRight className="mr-1 h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]/manage:rotate-90" />
                Manage
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent className={sectionItemsIndentClass}>
                <SidebarMenu>
                  {manageItems.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isItemActive(item.href)}
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
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>

        <SidebarGroup>
          <Collapsible
            open={observabilityOpen}
            onOpenChange={setObservabilityOpen}
            className="group/observability"
          >
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer">
                <ChevronRight className="mr-1 h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]/observability:rotate-90" />
                Monitor
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent className={sectionItemsIndentClass}>
                <SidebarMenu>
                  {observabilityItems.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isItemActive(item.href)}
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
            </CollapsibleContent>
          </Collapsible>
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
