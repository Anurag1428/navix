"use client"

import { MoreHorizontal, Plus, Workflow } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const WORKFLOWS = [
  { id: "1", name: "dominant-wasp" },
  { id: "2", name: "honest-reindeer" },
  { id: "3", name: "expected-llama" },
  { id: "4", name: "essential-ocelot" },
  { id: "5", name: "creepy-echidna" },
  { id: "6", name: "eastern-silkworm" },
  { id: "7", name: "cultural-lion" },
  { id: "8", name: "proud-weasel" },
  { id: "9", name: "regional-bonobo" },
  { id: "10", name: "silent-nautilus" },
] as const

export function WorkflowNav() {
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"

  if (isCollapsed) {
    return (
      <SidebarGroup>
        <Popover>
          <PopoverTrigger asChild>
            <SidebarMenuButton tooltip="Workflows" className="h-10 rounded-lg">
              <Workflow />
              <span className="sr-only">Workflows</span>
            </SidebarMenuButton>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-72 p-2">
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton className="h-10 rounded-lg">
                  <Plus />
                  <span>New workflow</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {WORKFLOWS.map((workflow, index) => (
                <SidebarMenuItem key={workflow.id}>
                  <SidebarMenuButton isActive={index === 0}>
                    <span>{workflow.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </PopoverContent>
        </Popover>
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Workflows</SidebarGroupLabel>
      <SidebarGroupAction title="New workflow">
        <Plus className="size-4" />
        <span className="sr-only">New workflow</span>
      </SidebarGroupAction>

      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {WORKFLOWS.map((workflow, index) => (
            <SidebarMenuItem key={workflow.id}>
              <SidebarMenuButton
                isActive={index === 0}
                className="h-10 rounded-lg"
              >
                <span className="truncate font-normal">{workflow.name}</span>
              </SidebarMenuButton>

              <SidebarMenuAction showOnHover>
                <MoreHorizontal className="size-4" />
                <span className="sr-only">More actions</span>
              </SidebarMenuAction>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}