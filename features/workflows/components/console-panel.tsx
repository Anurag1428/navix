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

// Discriminated union — exactly one thing can be selected at a time.
export type ConsoleSelection =
  | { kind: "step"; stepId: string }
  | { kind: "replay"; runId: string }

export function ConsolePanel() {
  const { workflowRuns } = useWorkflowRuns()
  const [selection, setSelection] = useState<ConsoleSelection | null>(null)

  const handleSelectStep = (stepId: string) => {
    setSelection((prev) =>
      prev?.kind === "step" && prev.stepId === stepId
        ? null
        : { kind: "step", stepId }
    )
  }

  const handleSelectReplay = (runId: string) => {
    setSelection((prev) =>
      prev?.kind === "replay" && prev.runId === runId
        ? null
        : { kind: "replay", runId }
    )
  }

  const handleClose = () => setSelection(null)

  // Resolve the selected step object when the selection is a step.
  const selectedStep = useMemo<RunStep | undefined>(() => {
    if (selection?.kind !== "step") return undefined
    for (const run of workflowRuns) {
      const found = run.steps.find((s) => s.id === selection.stepId)
      if (found) return found
    }
    return undefined
  }, [selection, workflowRuns])

  // Resolve the session id when the selection is a replay.
  const selectedReplaySessionId = useMemo<string | undefined>(() => {
    if (selection?.kind !== "replay") return undefined
    return workflowRuns.find((r) => r.id === selection.runId)?.sessionId
  }, [selection, workflowRuns])

  const isLive = workflowRuns.some((r) => r.isLive)
  const hasPanelOpen = selection !== null && (selectedStep !== undefined || selectedReplaySessionId !== undefined)

  // Label shown in the top bar.
  const selectionLabel = useMemo(() => {
    if (selection?.kind === "step" && selectedStep) {
      return { prefix: "Inspecting", value: selectedStep.title }
    }
    if (selection?.kind === "replay") {
      const run = workflowRuns.find((r) => r.id === selection.runId)
      const label = run
        ? `Run #${workflowRuns.length - workflowRuns.indexOf(run)}`
        : "Run"
      return { prefix: "Replaying", value: label }
    }
    return null
  }, [selection, selectedStep, workflowRuns])

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

        {selectionLabel && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {selectionLabel.prefix}:{" "}
              <strong className="text-foreground">{selectionLabel.value}</strong>
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleClose}
              title="Close panel"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Main split area: Runs List (LogsPanel) + Inspector / Replay */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
      >
        {/* Left side: Runs and Steps List */}
        <ResizablePanel defaultSize={hasPanelOpen ? 50 : 100} minSize={30}>
          <div className="size-full overflow-y-auto p-2.5">
            <LogsPanel
              selection={selection}
              onSelectStep={handleSelectStep}
              onSelectReplay={handleSelectReplay}
            />
          </div>
        </ResizablePanel>

        {/* Right side: Step Inspector or Session Replay */}
        {hasPanelOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={25}>
              <InspectorPanel
                step={selection?.kind === "step" ? selectedStep : undefined}
                sessionId={selection?.kind === "replay" ? selectedReplaySessionId : undefined}
                onClose={handleClose}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )
}
