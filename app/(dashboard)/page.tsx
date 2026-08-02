"use client"

import { Plus, Workflow } from "lucide-react"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <div className="flex min-h-full flex-1 py-1 pl-1 pr-1.5 md:py-1.5 md:pl-1.5 md:pr-2">
      <Empty className="min-h-full w-full rounded-2xl border border-solid border-border/70 bg-background/80 p-6 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.35)] backdrop-blur-sm md:p-10">
        <EmptyHeader className="max-w-none">
          <EmptyMedia variant="icon">
            <Workflow className="size-6" />
          </EmptyMedia>
          <EmptyContent className="max-w-2xl">
            <EmptyTitle>No workflow selected</EmptyTitle>
            <EmptyDescription>
              Select a workflow from the sidebar to get started, or create a new
              one to get started
            </EmptyDescription>
          </EmptyContent>
          <div className="mt-4 flex gap-2">
            <Button>
              <Plus />
              Create workflow
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
