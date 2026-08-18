"use client"

import { useTransition } from "react"
import { Loader2, PlayIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

import { runWorkflowAction } from "../actions"
import type { ActiveRun } from "./workflow-shell"

export function RightSidebar({ onRun }: { onRun: (run: ActiveRun) => void }) {
  const [isPending, startTransition] = useTransition()

  function handleRun() {
    startTransition(async () => {
      const run = await runWorkflowAction()
      onRun(run)
    })
  }

  return (
    <div className="flex size-full flex-col gap-3 p-3">
      <Button size="sm" onClick={handleRun} disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" /> : <PlayIcon />}
        Run
      </Button>
    </div>
  )
}
