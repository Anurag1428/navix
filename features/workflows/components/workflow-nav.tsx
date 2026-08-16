"use client"

import { useTransition } from "react"
import Link from "next/link"
import { Loader2, MoreHorizontal, Plus, Workflow as WorkflowIcon } from "lucide-react"

import type { Workflow } from "@/lib/db/schema"

import { generateSlug } from "@/features/workflows/lib/generate-slug"

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

export function WorkflowNav({
  workflows,
  createWorkflow,
}: {
  workflows: Workflow[]
  createWorkflow: (name: string) => Promise<void>
}) {
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"

  const [isPending, startTransition] = useTransition()

  function handleCreateWorkflow() {
    const slug = generateSlug()
    const name = slug
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")

    startTransition(() => {
      createWorkflow(name)
    })
  }

  if (isCollapsed) {
    return (
      <SidebarGroup>
        <Popover>
          <PopoverTrigger asChild>
            <SidebarMenuButton tooltip="Workflows" className="h-10 rounded-lg">
              <WorkflowIcon />
              <span className="sr-only">Workflows</span>
            </SidebarMenuButton>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-72 p-2">
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="h-10 rounded-lg"
                  onClick={handleCreateWorkflow}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Plus />
                  )}
                  <span>New workflow</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {workflows.map((workflow) => (
                <SidebarMenuItem key={workflow.id}>
                  <SidebarMenuButton asChild className="h-10 rounded-lg">
                    <Link href={`/workflow/${workflow.id}`}>
                      <span>{workflow.name}</span>
                    </Link>
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
      <SidebarGroupAction
        title="New workflow"
        onClick={handleCreateWorkflow}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        <span className="sr-only">New workflow</span>
      </SidebarGroupAction>

      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {workflows.map((workflow) => (
            <SidebarMenuItem key={workflow.id}>
              <SidebarMenuButton asChild className="h-10 rounded-lg">
                <Link href={`/workflow/${workflow.id}`}>
                  <span className="truncate font-normal">{workflow.name}</span>
                </Link>
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