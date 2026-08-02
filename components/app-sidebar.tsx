"use client"

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs"
import {
  Bug,
  Cat,
  Dog,
  Dna,
  Flame,
  Rabbit,
  Shell,
  Snail,
  Squirrel,
  Turtle,
  MoreHorizontal,
  Plus,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

const DUMMY_WORKFLOWS = [
  { id: "1", name: "dominant-wasp", icon: Bug, color: "#00C7A8" },
  { id: "2", name: "honest-reindeer", icon: Turtle, color: "#F4A432" },
  { id: "3", name: "expected-llama", icon: Rabbit, color: "#7C6FF7" },
  { id: "4", name: "essential-ocelot", icon: Cat, color: "#F4A432" },
  { id: "5", name: "creepy-echidna", icon: Snail, color: "#9B59B6" },
  { id: "6", name: "eastern-silkworm", icon: Dna, color: "#2ECC71" },
  { id: "7", name: "cultural-lion", icon: Flame, color: "#E74C3C" },
  { id: "8", name: "proud-weasel", icon: Squirrel, color: "#E91E8C" },
  { id: "9", name: "regional-bonobo", icon: Dog, color: "#3498DB" },
  { id: "10", name: "silent-nautilus", icon: Shell, color: "#1ABC9C" },
] as const

export function AppSidebar() {
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"

  return (
    <Sidebar collapsible="icon">
      {/* ── Header: OrganizationSwitcher + Collapse Trigger on same row ── */}
      <SidebarHeader className="p-2">
        <div className="flex items-center gap-1">
          {/* Org switcher — only visible when expanded */}
          {!isCollapsed && (
            <div className="flex-1 min-w-0 overflow-hidden">
              <OrganizationSwitcher
                hidePersonal
                appearance={{
                  elements: {
                    rootBox: "w-full overflow-hidden",
                    organizationSwitcherTrigger: [
                      "w-full rounded-md px-2 py-1.5 text-sm font-medium",
                      "text-sidebar-foreground transition-colors overflow-hidden",
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      "justify-start gap-2",
                    ].join(" "),
                    organizationSwitcherTriggerIcon: "ml-auto",
                  },
                }}
              />
            </div>
          )}

          {/* Sidebar toggle — always visible so user can re-open when collapsed */}
          <SidebarTrigger className={`shrink-0 ${isCollapsed ? "mx-auto" : ""}`} />
        </div>
      </SidebarHeader>

      {/* ── Content: Workflow list ── */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workflows</SidebarGroupLabel>
          <SidebarGroupAction title="New workflow">
            <Plus className="size-4" />
            <span className="sr-only">New workflow</span>
          </SidebarGroupAction>

          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {DUMMY_WORKFLOWS.map((workflow, index) => {
                const Icon = workflow.icon
                const isActive = index === 0
                return (
                  <SidebarMenuItem key={workflow.id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={workflow.name}
                      className="h-10 rounded-lg"
                    >
                      {/*
                       * Icon badge — must be exactly size-4 so it sits
                       * correctly inside the size-8 collapsed button box.
                       * We use a relative wrapper that doesn't add extra size.
                       */}
                      <span
                        className="flex size-5 shrink-0 items-center justify-center rounded"
                        style={{ backgroundColor: `${workflow.color}22` }}
                      >
                        <Icon
                          className="size-3.5"
                          style={{ color: workflow.color }}
                        />
                      </span>
                      <span className="truncate font-normal">
                        {workflow.name}
                      </span>
                    </SidebarMenuButton>

                    <SidebarMenuAction showOnHover>
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">More actions</span>
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ── Footer: UserButton ── */}
      <SidebarFooter className="p-2">
        <UserButton
          showName={!isCollapsed}
          appearance={{
            elements: {
              rootBox: "w-full overflow-hidden",
              userButtonTrigger: [
                "w-full rounded-md px-2 py-1.5 text-sm font-medium",
                "text-sidebar-foreground transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isCollapsed ? "justify-center gap-0" : "justify-start gap-2",
              ].join(" "),
              userButtonBox: isCollapsed ? "hidden" : "flex items-center gap-2",
            },
          }}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
