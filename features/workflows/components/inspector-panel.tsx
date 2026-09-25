"use client"

import { useMemo, useState } from "react"
import { AlertCircle, Check, Copy, Loader2, X } from "lucide-react"
import prettyMs from "pretty-ms"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { NodeIcon } from "@/features/workflows/components/right-sidebar"
import type { RunStep } from "@/features/workflows/components/workflow-runs-provider"
import type { NodeType } from "@/features/workflows/nodes/node-registry"

export type InspectorPanelProps = {
  step: RunStep
  onClose?: () => void
  className?: string
}

export function InspectorPanel({
  step,
  onClose,
  className,
}: InspectorPanelProps) {
  const [copied, setCopied] = useState(false)

  const hasOutput = step.output !== undefined
  const hasError = !!step.error

  const formattedOutput = useMemo(() => {
    if (step.output === undefined) return ""
    if (typeof step.output === "object" && step.output !== null) {
      try {
        return JSON.stringify(step.output, null, 2)
      } catch {
        return String(step.output)
      }
    }
    return String(step.output)
  }, [step.output])

  const copyOutput = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={cn(
        "flex w-80 sm:w-96 min-h-0 shrink-0 flex-col overflow-hidden bg-card/40",
        className
      )}
    >
      {/* Inspector Header */}
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/30 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <NodeIcon type={step.nodeType as NodeType} />
          <div className="min-w-0">
            <h4 className="text-xs font-semibold truncate text-foreground">
              {step.title}
            </h4>
            <p className="text-[10px] font-mono text-muted-foreground truncate">
              Node ID: {step.id}
            </p>
          </div>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            title="Close inspector"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Inspector Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {/* Status and Duration metrics */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border border-border/60 bg-background/60 p-2">
            <p className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider">
              Status
            </p>
            <p
              className={cn(
                "mt-0.5 font-semibold text-xs capitalize",
                step.status === "done" && "text-emerald-500",
                step.status === "failed" && "text-destructive",
                step.status === "running" && "text-blue-500",
                step.status === "pending" && "text-muted-foreground"
              )}
            >
              {step.status}
            </p>
          </div>

          <div className="rounded-md border border-border/60 bg-background/60 p-2">
            <p className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider">
              Duration
            </p>
            <p className="mt-0.5 font-mono text-xs font-medium">
              {step.durationMs !== undefined
                ? prettyMs(Math.max(0, step.durationMs))
                : step.status === "running"
                  ? "Running..."
                  : "-"}
            </p>
          </div>
        </div>

        {/* Error Section */}
        {hasError && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>Error</span>
            </div>
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 font-mono text-[11px] text-destructive overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {step.error}
            </div>
            {step.errorStack && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                  View Stack Trace
                </summary>
                <pre className="mt-1 max-h-36 overflow-x-auto rounded bg-muted/50 p-2 text-[10px] font-mono text-muted-foreground leading-normal">
                  {step.errorStack}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Output Section */}
        {hasOutput && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                Output
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => copyOutput(formattedOutput)}
                className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <>
                    <Check className="size-2.5 text-emerald-500" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-2.5" />
                    <span>Copy JSON</span>
                  </>
                )}
              </Button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md border border-border/70 bg-muted/30 p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
              {formattedOutput}
            </pre>
          </div>
        )}

        {/* Running State Info */}
        {step.status === "running" && !hasOutput && !hasError && (
          <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 p-2.5 text-xs text-blue-500">
            <Loader2 className="size-3.5 animate-spin shrink-0" />
            <span>Step is currently executing...</span>
          </div>
        )}

        {/* Short note when there's nothing */}
        {!hasError && !hasOutput && step.status !== "running" && (
          <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground italic text-center">
            {step.status === "done" && (
              <p>No output produced for this step.</p>
            )}
            {step.status === "pending" && (
              <p>This step has not run yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
