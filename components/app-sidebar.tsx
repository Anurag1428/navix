import { auth } from "@clerk/nextjs/server"
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs"

import Link from "next/link"
import { Globe } from "lucide-react"

import {
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
  SidebarTrigger,
} from "@/components/ui/sidebar"

import { WorkflowNav } from "@/features/workflows/components/workflow-nav"
import { listWorkflows } from "@/features/workflows/data"
import { createWorkflowAction } from "@/features/workflows/actions"

export async function AppSidebar() {
  const { orgId } = await auth()
  const workflows = orgId ? await listWorkflows(orgId) : []

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-2">
        <div className="flex items-center gap-1">
          <OrganizationSwitcher
          afterCreateOrganizationUrl="/"
          afterSelectOrganizationUrl="/"
          afterLeaveOrganizationUrl="/"
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

          <SidebarTrigger className="shrink-0" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Connected Accounts" className="h-10 rounded-lg">
                  <Link href="/accounts">
                    <Globe className="size-4" />
                    <span>Connected Accounts</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <WorkflowNav workflows={workflows} createWorkflow={createWorkflowAction} />
      </SidebarContent>

      <SidebarFooter className="p-2">
        <UserButton
          appearance={{
            elements: {
              rootBox: "w-full overflow-hidden",
              userButtonTrigger: [
                "w-full rounded-md px-2 py-1.5 text-sm font-medium",
                "text-sidebar-foreground transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "justify-start gap-2",
              ].join(" "),
              userButtonBox: "flex items-center gap-2",
            },
          }}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
