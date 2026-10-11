"use client"

import { useState, useTransition } from "react"
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useWorkflowRuns } from "@/features/workflows/components/workflow-runs-provider"
import { completeHumanActionTokenAction } from "@/features/workflows/actions"

export type HumanActionData = {
  tokenId: string
  reason: string
  url?: string
  step?: number
}

export function HumanActionBanner() {
  const { workflowRuns } = useWorkflowRuns()
  const [isPending, startTransition] = useTransition()
  const [isResolved, setIsResolved] = useState(false)

  // Find any live run that has humanActionNeeded in its metadata
  const liveRunWithAction = workflowRuns.find((run) => {
    return run.isLive && !!run.metadata?.humanActionNeeded
  })

  if (!liveRunWithAction || isResolved) return null

  const data = liveRunWithAction.metadata?.humanActionNeeded as HumanActionData | undefined
  if (!data?.tokenId) return null

  const handleResume = () => {
    startTransition(async () => {
      try {
        await completeHumanActionTokenAction(data.tokenId)
        setIsResolved(true)
        toast.success("Workflow resumed! Agent is continuing...")
      } catch (err: any) {
        toast.error(err?.message || "Failed to resume workflow")
      }
    })
  }

  return (
    <div className="mx-2 my-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs shadow-sm transition-all">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="rounded-full bg-amber-500/20 p-1.5 text-amber-500 shrink-0 mt-0.5 sm:mt-0">
            <ShieldAlert className="size-4 animate-pulse" />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-amber-500">Human Action Required</span>
              {data.step && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-mono text-amber-400">
                  Step #{data.step}
                </span>
              )}
            </div>
            <p className="text-muted-foreground font-medium">
              {data.reason || "CAPTCHA, 2FA, or security challenge detected in the browser."}
            </p>
            {data.url && (
              <p className="text-[11px] text-muted-foreground/80 truncate max-w-lg mt-0.5">
                Target: <span className="font-mono text-[10px] text-foreground">{data.url}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {liveRunWithAction.sessionId && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs border-amber-500/30 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
              onClick={() => {
                window.open(
                  `https://browserbase.com/sessions/${liveRunWithAction.sessionId}`,
                  "_blank"
                )
              }}
            >
              <ExternalLink className="size-3" />
              <span>Live View</span>
            </Button>
          )}

          <Button
            size="sm"
            onClick={handleResume}
            disabled={isPending}
            className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            <span>I've Solved It — Resume</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
