"use client"

import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Target,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { WorkflowRun } from "@/features/workflows/components/workflow-runs-provider"

export type GoalOutcomeCardProps = {
  run?: WorkflowRun
  className?: string
  compact?: boolean
}

type ResolvedOutcome = {
  key: "live" | "achieved" | "not_achieved" | "unverified" | "blocked"
  label: string
  badgeVariant: "default" | "destructive" | "secondary" | "outline"
  badgeClasses: string
  containerClasses: string
  iconBgClasses: string
}

function resolveOutcome(run: WorkflowRun): ResolvedOutcome {
  if (run.isLive) {
    return {
      key: "live",
      label: "Executing & Verifying",
      badgeVariant: "outline",
      badgeClasses: "border-blue-500/40 bg-blue-500/10 text-blue-500",
      containerClasses: "border-blue-500/30 bg-blue-500/5",
      iconBgClasses: "bg-blue-500 text-white",
    }
  }

  const evaluation = run.goalEvaluation
  const status = evaluation?.status

  if (status === "blocked") {
    return {
      key: "blocked",
      label: "Blocked (Action Required)",
      badgeVariant: "outline",
      badgeClasses: "border-amber-500/40 bg-amber-500/20 text-amber-600 dark:text-amber-400",
      containerClasses: "border-amber-500/30 bg-amber-500/10",
      iconBgClasses: "bg-amber-600 text-white",
    }
  }

  if (status === "unverified") {
    return {
      key: "unverified",
      label: "Unverified (Insufficient Evidence)",
      badgeVariant: "outline",
      badgeClasses: "border-yellow-500/40 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
      containerClasses: "border-yellow-500/30 bg-yellow-500/10",
      iconBgClasses: "bg-yellow-600 text-white",
    }
  }

  if (status === "not_achieved" || status === "failed" || run.status === "FAILED" || run.status === "CRASHED") {
    return {
      key: "not_achieved",
      label: "Not Achieved",
      badgeVariant: "outline",
      badgeClasses: "border-destructive/40 bg-destructive/20 text-destructive",
      containerClasses: "border-destructive/30 bg-destructive/10",
      iconBgClasses: "bg-destructive text-white",
    }
  }

  // Achieved
  return {
    key: "achieved",
    label: "Goal Achieved",
    badgeVariant: "outline",
    badgeClasses: "border-emerald-500/40 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
    containerClasses: "border-emerald-500/30 bg-emerald-500/10",
    iconBgClasses: "bg-emerald-600 text-white",
  }
}

export function GoalOutcomeCard({ run, className, compact = false }: GoalOutcomeCardProps) {
  if (!run) return null

  const evaluation = run.goalEvaluation
  if (!evaluation && !run.isLive && run.steps.length === 0) {
    return null
  }

  const outcome = resolveOutcome(run)

  if (compact) {
    return (
      <div
        className={cn(
          "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
          outcome.containerClasses,
          className
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 font-medium">
            {outcome.key === "live" && (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />
            )}
            {outcome.key === "achieved" && (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
            )}
            {outcome.key === "not_achieved" && (
              <XCircle className="size-3.5 shrink-0 text-destructive" />
            )}
            {outcome.key === "unverified" && (
              <HelpCircle className="size-3.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
            )}
            {outcome.key === "blocked" && (
              <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <span className="truncate font-semibold text-[11px]">
              {outcome.label}
            </span>
          </div>

          {evaluation?.evidence && (
            <span className="text-[10px] font-mono opacity-80 truncate max-w-[200px]" title={evaluation.evidence}>
              {evaluation.evidence}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-3 shadow-xs transition-all",
        outcome.containerClasses,
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md text-white",
              outcome.iconBgClasses
            )}
          >
            {outcome.key === "live" && <Loader2 className="size-3.5 animate-spin" />}
            {outcome.key === "achieved" && <ShieldCheck className="size-3.5" />}
            {outcome.key === "not_achieved" && <Target className="size-3.5" />}
            {outcome.key === "unverified" && <HelpCircle className="size-3.5" />}
            {outcome.key === "blocked" && <ShieldAlert className="size-3.5" />}
          </span>
          <div>
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              Goal Outcome
            </h4>
            {evaluation?.goal && (
              <p className="text-[11px] text-muted-foreground truncate max-w-[280px]">
                {evaluation.goal}
              </p>
            )}
          </div>
        </div>

        <Badge
          variant="outline"
          className={cn("text-[10px] px-2 py-0.5 font-semibold", outcome.badgeClasses)}
        >
          {outcome.label}
        </Badge>
      </div>

      {/* Summary */}
      {evaluation?.summary && (
        <p className="text-xs text-foreground/90 mt-1.5 leading-relaxed">
          {evaluation.summary}
        </p>
      )}

      {/* Proof & Evidence Block */}
      {evaluation?.evidence && (
        <div className="mt-2 rounded border border-border/50 bg-background/60 p-2 text-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
            Proof &amp; Evidence
          </p>
          <p className="font-mono text-[11px] text-foreground/90 break-words">
            {evaluation.evidence}
          </p>
        </div>
      )}
    </div>
  )
}
