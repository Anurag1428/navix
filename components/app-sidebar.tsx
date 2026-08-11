import { OrganizationSwitcher, UserButton } from "@clerk/nextjs"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from "@/components/ui/sidebar"

import { WorkflowNav } from "@/features/workflows/components/workflow-nav"

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-2">
        <div className="flex items-center gap-1">
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

          <SidebarTrigger className="shrink-0" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <WorkflowNav />
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
