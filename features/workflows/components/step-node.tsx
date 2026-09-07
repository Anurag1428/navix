"use client"

import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Loader2 } from "lucide-react"

import {
  nodeRegistry,
  type StepNodeType,
} from "@/features/workflows/nodes/node-registry"
import { useLatestRunSteps } from "@/features/workflows/components/workflow-runs-provider"
import { cn } from "@/lib/utils"

function StepNodeComponent({ id, data, selected }: NodeProps<StepNodeType>) {
  const { type, kind, title, values } = data
  const def = nodeRegistry[type]
  const Icon = def.icon
  const fields = def.fields.filter((field) => values[field.key])

  const { steps, isLive } = useLatestRunSteps()
  const stepStatus = steps?.find((step) => step.id === id)?.status

  // "running" is shown only while the run is still active (executing,
  // reattempting, or otherwise not finished). Otherwise a node can be
  // left stuck with a blue outline after the run has ended.
  const isRunning = stepStatus === "running" && isLive
  const isFailed = stepStatus === "failed"

  // A trigger starts the flow and takes no input, so it has no target handle.
  const hasTarget = kind !== "trigger"

  return (
    <div
      className={cn(
        "min-w-50 max-w-80 rounded-(--radius) border-2 border-border bg-card text-card-foreground",
        isRunning && "border-blue-500",
        isFailed && "border-red-500",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background"
      )}
    >
      {hasTarget && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ transform: "translate(-100%, -50%)" }}
          className="h-3.5! w-1.5! min-w-0! rounded-l-xs! rounded-r-none! border-0! bg-border!"
        />
      )}

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            def.accent
          )}
        >
          {isRunning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Icon className="size-4" />
          )}
        </div>
        <span className="text-sm font-semibold">{title}</span>
      </div>

          {fields.length > 0 && (
            <>
              <div className="border-t border-border" />
              <div className="flex flex-col gap-1.5 px-3 py-2.5">
                {fields.map((field) => (
                  <div
                    key={field.key}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {field.label}
                    </span>
                    <span className="truncate font-medium">{values[field.key]}</span>
                  </div>
                ))}
              </div>
            </>
          )}

      <Handle
        type="source"
        position={Position.Right}
        style={{ transform: "translate(100%, -50%)" }}
        className="h-3.5! w-1.5! min-w-0! rounded-l-none! rounded-r-xs! border-0! bg-border!"
      />
    </div>
  )
}

export const StepNode = memo(StepNodeComponent)