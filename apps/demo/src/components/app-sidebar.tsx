"use client"

import * as React from "react"
import { GalleryVerticalEnd, Map, Package, Truck } from "lucide-react"

import { business } from "@/business/dispatch"
import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

// App-owned navigation and identity; foundation releases never replace this file.
const data = {
  user: {
    name: "Morgan Chen",
    email: "dispatch@northstar.example",
    avatar: "",
  },
  teams: [{ name: business.name, logo: GalleryVerticalEnd, plan: "Regional freight" }],
  navMain: [
    {
      title: "Dispatch",
      url: "/dashboard",
      icon: Truck,
      isActive: true,
      items: [{ title: "Ready loads", url: "/dashboard" }],
    },
  ],
  projects: [
    { name: "Oakland corridor", url: "/dashboard", icon: Map },
    { name: "Sacramento corridor", url: "/dashboard", icon: Package },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects projects={data.projects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
