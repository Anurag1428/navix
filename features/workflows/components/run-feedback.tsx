"use client"

import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

type RunFeedbackProps = {
  runId: string
  publicAccessToken: string
}

const RUNNING_STATUSES = new Set(["QUEUED", "EXECUTING", "REATTEMPTING", "DELAYED"])
const DONE_STATUSES = new Set(["COMPLETED", "FAILED", "CRASHED", "CANCELED", "TIMED_OUT", "EXPIRED"])

export function RunFeedback({ runId, publicAccessToken }: RunFeedbackProps) {
  const { run, error } = useRealtimeRun<typeof helloWorldTask>(runId, {
    accessToken: publicAccessToken,
    skipColumns: ["payload"],
  })

  if (error) {
    return (
      <p className="text-sm text-destructive">Failed to subscribe to run: {error.message}</p>
    )
  }

  if (!run) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Waiting for run updates&hellip;
      </div>
    )
  }

  const progress = run.metadata?.progress as
    | { current?: number; total?: number; percentage?: number; currentStep?: string }
    | undefined
  const logs = run.metadata?.logs as string[] | undefined
  const isRunning = RUNNING_STATUSES.has(run.status)
  const isDone = DONE_STATUSES.has(run.status)

  return (
    <div className="flex size-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <Badge
          variant={
            run.status === "COMPLETED"
              ? "default"
              : run.status === "FAILED" || run.status === "CRASHED"
                ? "destructive"
                : "secondary"
          }
        >
          {isRunning && <Loader2 className="size-3 animate-spin" />}
          {run.status}
        </Badge>
        <span className="truncate text-xs text-muted-foreground">
          {run.id} &middot; {run.taskIdentifier}
        </span>
      </div>

      {progress && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{progress.currentStep ?? "Running"}</span>
            <span>{progress.percentage ?? 0}%</span>
          </div>
          <Progress value={progress.percentage ?? 0} />
        </div>
      )}

      {logs && logs.length > 0 && (
        <div className="flex flex-col gap-1">
          {logs.map((log, index) => (
            <p key={index} className="text-xs font-mono text-muted-foreground">
              &gt; {log}
            </p>
          ))}
        </div>
      )}

      {run.output && (
        <div className="rounded-md border border-border/70 bg-muted/40 p-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Output</p>
          <pre className="overflow-x-auto text-xs font-mono">{JSON.stringify(run.output, null, 2)}</pre>
        </div>
      )}

      {isDone && !run.output && !run.error && (
        <p className="text-xs text-muted-foreground">Run finished with no output.</p>
      )}
    </div>
  )
}
