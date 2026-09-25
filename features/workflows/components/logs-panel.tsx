"use client"

import { useState } from "react"
import { CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, XCircle } from "lucide-react"
import prettyMs from "pretty-ms"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { NodeIcon } from "@/features/workflows/components/right-sidebar"
import { useWorkflowRuns, type WorkflowRun, type RunStep } from "@/features/workflows/components/workflow-runs-provider"
import type { NodeType } from "@/features/workflows/nodes/node-registry"

export type LogsPanelProps = {
  selectedStepId?: string | null
  onSelectStep?: (stepId: string, runId: string) => void
  className?: string
}

export function LogsPanel({
  selectedStepId,
  onSelectStep,
  className,
}: LogsPanelProps) {
  const { workflowRuns } = useWorkflowRuns()
  const [collapsedRuns, setCollapsedRuns] = useState<Record<string, boolean>>({})

  const toggleRunCollapse = (runId: string) => {
    setCollapsedRuns((prev) => ({
      ...prev,
      [runId]: !prev[runId],
    }))
  }

  if (workflowRuns.length === 0) {
    return (
      <div className={cn("flex size-full flex-col items-center justify-center p-6 text-center", className)}>
        <Clock className="size-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm font-medium text-muted-foreground">No workflow runs yet</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Click &ldquo;Run&rdquo; in the sidebar to execute this workflow.
        </p>
      </div>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      {workflowRuns.map((run, index) => {
        const isCollapsed = !!collapsedRuns[run.id]
        const runNumber = workflowRuns.length - index

        return (
          <div
            key={run.id}
            className="rounded-lg border border-border/70 bg-card/60 p-2.5 shadow-xs transition-colors"
          >
            {/* Run Header */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggleRunCollapse(run.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  toggleRunCollapse(run.id)
                }
              }}
              className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50 transition-colors select-none"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isCollapsed ? (
                  <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="font-semibold text-foreground">
                  Run #{runNumber}
                </span>
                <span className="truncate font-mono text-[10px] text-muted-foreground" title={run.id}>
                  {run.id.slice(0, 8)}
                </span>
                <RunBadge run={run} />
              </div>

              <div className="flex items-center gap-2 shrink-0 text-[11px] text-muted-foreground font-mono">
                {run.durationMs !== undefined && (
                  <span>{prettyMs(Math.max(0, run.durationMs))}</span>
                )}
                <span>
                  {new Date(run.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
            </div>

            {/* Steps List */}
            {!isCollapsed && (
              <div className="mt-1.5 space-y-1 pl-4 border-l-2 border-border/40 ml-2">
                {run.steps.length === 0 ? (
                  <p className="py-1 text-xs italic text-muted-foreground/70">
                    {run.isLive ? "Initializing steps..." : "No steps recorded."}
                  </p>
                ) : (
                  run.steps.map((step) => {
                    const isSelected = selectedStepId === step.id
                    const isRunning = step.status === "running"
                    const isFailed = step.status === "failed"
                    const isDone = step.status === "done"
                    const isPending = step.status === "pending"

                    return (
                      <div
                        key={step.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectStep?.(step.id, run.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            onSelectStep?.(step.id, run.id)
                          }
                        }}
                        className={cn(
                          "group flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-xs transition-all select-none border",
                          // Default / Done state
                          isDone && "border-transparent bg-background/50 hover:bg-muted/60 text-foreground",
                          // Failed: turns red
                          isFailed && "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 font-medium",
                          // Running: spins while it's running
                          isRunning && "border-blue-500/30 bg-blue-500/10 text-blue-500 font-medium",
                          // Inactive: looks inactive if it never ran
                          isPending && "border-transparent opacity-40 text-muted-foreground/80 hover:opacity-70 bg-transparent",
                          // Selected state: ring & highlight
                          isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background bg-accent text-accent-foreground font-semibold shadow-xs"
                        )}
                      >
                        {/* Step Left: Node icon & title */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="relative flex shrink-0 items-center justify-center">
                            {isRunning ? (
                              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-500 text-white animate-spin">
                                <Loader2 className="size-3.5" />
                              </span>
                            ) : (
                              <NodeIcon
                                type={step.nodeType as NodeType}
                                className={cn(
                                  isFailed && "bg-destructive text-destructive-foreground",
                                  isPending && "opacity-60 grayscale"
                                )}
                              />
                            )}
                          </div>
                          <span
                            className={cn(
                              "truncate",
                              isFailed && "text-destructive font-medium",
                              isPending && "text-muted-foreground",
                              isRunning && "text-blue-500"
                            )}
                          >
                            {step.title}
                          </span>
                          {isRunning && (
                            <span className="text-[10px] text-blue-500/80 font-normal animate-pulse">
                              running&hellip;
                            </span>
                          )}
                        </div>

                        {/* Step Right: Duration formatted with pretty-ms & status icon */}
                        <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                          {step.durationMs !== undefined ? (
                            <span
                              className={cn(
                                isFailed ? "text-destructive font-semibold" : "text-muted-foreground"
                              )}
                            >
                              {prettyMs(Math.max(0, step.durationMs))}
                            </span>
                          ) : isRunning ? (
                            <div className="flex items-center gap-1 text-blue-500">
                              <Loader2 className="size-3 animate-spin" />
                            </div>
                          ) : isPending ? (
                            <span className="text-muted-foreground/40">&ndash;</span>
                          ) : null}

                          {isFailed && (
                            <XCircle className="size-3.5 text-destructive shrink-0" />
                          )}
                          {isDone && (
                            <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RunBadge({ run }: { run: WorkflowRun }) {
  if (run.isLive) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-blue-500/40 bg-blue-500/10 text-blue-500 text-[10px] px-1.5 py-0 font-medium"
      >
        <Loader2 className="size-2.5 animate-spin" />
        {run.status}
      </Badge>
    )
  }

  if (run.status === "COMPLETED") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 text-[10px] px-1.5 py-0 font-medium"
      >
        Completed
      </Badge>
    )
  }

  if (run.status === "FAILED" || run.status === "CRASHED") {
    return (
      <Badge
        variant="outline"
        className="border-destructive/40 bg-destructive/10 text-destructive text-[10px] px-1.5 py-0 font-medium"
      >
        Failed
      </Badge>
    )
  }

  return (
    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">
      {run.status}
    </Badge>
  )
}
