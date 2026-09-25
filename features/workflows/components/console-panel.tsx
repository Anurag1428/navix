"use client"

import { useMemo, useState } from "react"
import { Terminal, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { useWorkflowRuns, type RunStep } from "@/features/workflows/components/workflow-runs-provider"
import { LogsPanel } from "./logs-panel"
import { InspectorPanel } from "./inspector-panel"

export function ConsolePanel() {
  const { workflowRuns } = useWorkflowRuns()
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)

  // Clicking a step selects it, clicking again deselects
  const handleSelectStep = (stepId: string) => {
    setSelectedStepId((prev) => (prev === stepId ? null : stepId))
  }

  // Find the selected step across all workflow runs
  const selectedStep = useMemo<RunStep | undefined>(() => {
    if (!selectedStepId) return undefined
    for (const run of workflowRuns) {
      const found = run.steps.find((s) => s.id === selectedStepId)
      if (found) return found
    }
    return undefined
  }, [selectedStepId, workflowRuns])

  const isLive = workflowRuns.some((r) => r.isLive)

  return (
    <div className="flex size-full flex-col overflow-hidden bg-background">
      {/* Console Top Bar */}
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold text-foreground">Console</p>
          {workflowRuns.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium">
              {workflowRuns.length} {workflowRuns.length === 1 ? "run" : "runs"}
            </span>
          )}
          {isLive && (
            <span className="flex items-center gap-1.5 text-[10px] text-blue-500 font-medium">
              <span className="relative flex size-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full size-2 bg-blue-500" />
              </span>
              Running
            </span>
          )}
        </div>

        {selectedStep && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              Inspecting: <strong className="text-foreground">{selectedStep.title}</strong>
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSelectedStepId(null)}
              title="Deselect step"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Main split area: Runs List (LogsPanel) + Step Inspector */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
      >
        {/* Left side: Runs and Steps List */}
        <ResizablePanel defaultSize={selectedStep ? 50 : 100} minSize={30}>
          <div className="size-full overflow-y-auto p-2.5">
            <LogsPanel
              selectedStepId={selectedStepId}
              onSelectStep={handleSelectStep}
            />
          </div>
        </ResizablePanel>

        {/* Right side: Selected Step Inspector */}
        {selectedStep && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={25}>
              <InspectorPanel
                step={selectedStep}
                onClose={() => setSelectedStepId(null)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )
}

