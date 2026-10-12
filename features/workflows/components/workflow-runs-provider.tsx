"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useRealtimeRun, useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"

import type { runWorkflowTask, RunStep, GoalEvaluation } from "@/features/workflows/tasks/run-workflow"

export type { RunStep, GoalEvaluation }

export type ActiveRun = {
    runId: string
    publicAccessToken: string
}

export type LatestRunSteps = {
    steps: RunStep[] | undefined
    isLive: boolean
    runStatus?: string
}

export type WorkflowRun = {
    id: string
    status: string
    createdAt: Date | string
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number
    error?: unknown
    steps: RunStep[]
    sessionId?: string
    isLive: boolean
    metadata?: Record<string, unknown>
    goalEvaluation?: GoalEvaluation
    raw: ReturnType<
        typeof useRealtimeRunsWithTag<typeof runWorkflowTask>
    >["runs"][number]
}

export type WorkflowRunsApi = {
    runs: ReturnType<
        typeof useRealtimeRunsWithTag<typeof runWorkflowTask>
    >["runs"]
    workflowRuns: WorkflowRun[]
    error: Error | undefined
    activeRun: ActiveRun | null
    setActiveRun: React.Dispatch<React.SetStateAction<ActiveRun | null>>
    selectedRunId: string | null
    setSelectedRunId: React.Dispatch<React.SetStateAction<string | null>>
    selectedRun: WorkflowRun | undefined
    selectedStepId: string | null
    setSelectedStepId: React.Dispatch<React.SetStateAction<string | null>>
    selectedStep: RunStep | undefined
    getRunSteps: (
        runOrId:
            | ReturnType<typeof useRealtimeRunsWithTag<typeof runWorkflowTask>>["runs"][number]
            | string
    ) => RunStep[]
    getRunSessionId: (
        runOrId:
            | ReturnType<typeof useRealtimeRunsWithTag<typeof runWorkflowTask>>["runs"][number]
            | string
    ) => string | undefined
    useLatestRunSteps: () => LatestRunSteps
}

const WorkflowRunsContext = createContext<WorkflowRunsApi | null>(null)

const FINISHED_STATUSES = new Set([
    "COMPLETED",
    "FAILED",
    "CANCELED",
    "CRASHED",
    "TIMED_OUT",
    "EXPIRED",
])

export function isLiveStatus(status?: string): boolean {
    if (!status) return false
    return !FINISHED_STATUSES.has(status)
}

export function extractSessionId(run?: {
    output?: unknown
}): string | undefined {
    if (!run?.output) return undefined

    if (typeof run.output === "object" && run.output !== null) {
        const output = run.output as { sessionId?: unknown }
        if (typeof output.sessionId === "string" && output.sessionId.length > 0) {
            return output.sessionId
        }
    }

    if (typeof run.output === "string") {
        try {
            const parsed = JSON.parse(run.output)
            if (parsed && typeof parsed.sessionId === "string" && parsed.sessionId.length > 0) {
                return parsed.sessionId
            }
        } catch {
            // Ignore parse errors
        }
    }

    return undefined
}

export function extractRunSteps(run?: {
    output?: unknown
    metadata?: Record<string, unknown>
}): RunStep[] {
    if (!run) return []
    if (Array.isArray(run.output) && run.output.length > 0) {
        return run.output as RunStep[]
    }
    const outputSteps = (run.output as { steps?: RunStep[] } | undefined)?.steps
    if (Array.isArray(outputSteps) && outputSteps.length > 0) {
        return outputSteps
    }
    const metadataSteps = run.metadata?.steps as RunStep[] | undefined
    if (Array.isArray(metadataSteps) && metadataSteps.length > 0) {
        return metadataSteps
    }
    return []
}

export function extractGoalEvaluation(run?: {
    output?: unknown
    metadata?: Record<string, unknown>
    steps?: RunStep[]
}): GoalEvaluation | undefined {
    if (!run) return undefined

    // 1. Direct from metadata
    if (run.metadata?.goalEvaluation && typeof run.metadata.goalEvaluation === "object") {
        const raw = run.metadata.goalEvaluation as any
        const rawStatus = raw.status
        const status =
            rawStatus === "achieved" ||
            rawStatus === "not_achieved" ||
            rawStatus === "unverified" ||
            rawStatus === "blocked"
                ? rawStatus
                : raw.achieved
                  ? "achieved"
                  : "not_achieved"

        return {
            achieved: status === "achieved",
            status,
            goal: raw.goal,
            summary: raw.summary,
            evidence: raw.evidence,
        }
    }

    // 2. Direct from output
    if (run.output && typeof run.output === "object") {
        const outObj = run.output as { goalEvaluation?: GoalEvaluation }
        if (outObj.goalEvaluation) {
            const raw = outObj.goalEvaluation as any
            const rawStatus = raw.status
            const status =
                rawStatus === "achieved" ||
                rawStatus === "not_achieved" ||
                rawStatus === "unverified" ||
                rawStatus === "blocked"
                    ? rawStatus
                    : raw.achieved
                      ? "achieved"
                      : "not_achieved"

            return {
                achieved: status === "achieved",
                status,
                goal: raw.goal,
                summary: raw.summary,
                evidence: raw.evidence,
            }
        }
    }

    // 3. Fallback: inspect steps
    const steps = extractRunSteps(run)
    const failedStep = steps.find((s) => s.status === "failed")
    if (failedStep) {
        const errorMsg = failedStep.error || `Step "${failedStep.title}" failed.`
        const isBlocked =
            errorMsg.toLowerCase().includes("captcha") ||
            errorMsg.toLowerCase().includes("turnstile") ||
            errorMsg.toLowerCase().includes("cloudflare") ||
            errorMsg.toLowerCase().includes("human intervention") ||
            errorMsg.toLowerCase().includes("security challenge")

        return {
            achieved: false,
            status: isBlocked ? "blocked" : "not_achieved",
            goal: failedStep.title,
            summary: errorMsg,
            evidence: failedStep.error,
        }
    }

    const verifyOrAgentStep = steps
        .slice()
        .reverse()
        .find(
            (s) =>
                (s.nodeType === "verify" || s.nodeType === "agent") &&
                s.status === "done" &&
                s.output !== undefined
        )

    if (
        verifyOrAgentStep &&
        typeof verifyOrAgentStep.output === "object" &&
        verifyOrAgentStep.output !== null
    ) {
        const out = verifyOrAgentStep.output as any
        const rawStatus = out.status as string | undefined
        const status =
            rawStatus === "achieved" ||
            rawStatus === "not_achieved" ||
            rawStatus === "unverified" ||
            rawStatus === "blocked"
                ? rawStatus
                : (out.achieved ?? out.success ?? true)
                  ? "achieved"
                  : "not_achieved"

        return {
            achieved: status === "achieved",
            status,
            goal: out.criterion || verifyOrAgentStep.title,
            summary: out.summary || out.message,
            evidence: out.evidence,
        }
    }

    return undefined
}

export function WorkflowRunsProvider({
    workflowId,
    publicAccessToken,
    children,
}: {
    workflowId: string
    publicAccessToken: string
    children: ReactNode
}) {
    const [activeRun, setActiveRun] = useState<ActiveRun | null>(null)
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
    const [selectedStepId, setSelectedStepId] = useState<string | null>(null)

    const { runs, error: tagError } = useRealtimeRunsWithTag<typeof runWorkflowTask>(
        `workflow:${workflowId}`,
        { accessToken: publicAccessToken },
    )

    // Auto-select newly triggered run if activeRun is set
    useEffect(() => {
        if (activeRun?.runId) {
            setSelectedRunId(activeRun.runId)
        }
    }, [activeRun?.runId])

    const latestTagRun = useMemo(() => {
        return runs
            .slice()
            .sort(
                (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
            )[0]
    }, [runs])

    const targetRunId =
        activeRun?.runId ??
        (selectedRunId && runs.some((r) => r.id === selectedRunId && isLiveStatus(r.status))
            ? selectedRunId
            : (latestTagRun && isLiveStatus(latestTagRun.status) ? latestTagRun.id : undefined))
    const targetToken = activeRun ? activeRun.publicAccessToken : publicAccessToken

    const { run: liveRun, error: liveRunError } = useRealtimeRun(targetRunId ?? "", {
        accessToken: targetToken,
        enabled: !!targetRunId,
        skipColumns: ["payload"],
    })

    const error = tagError ?? liveRunError

    const workflowRuns = useMemo<WorkflowRun[]>(() => {
        const sorted = runs
            .slice()
            .sort(
                (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
            )

        const hasLiveRunInList = liveRun && sorted.some((r) => r.id === liveRun.id)
        const allRuns = (!hasLiveRunInList && liveRun) ? [liveRun, ...sorted] : sorted

        return allRuns.map((run) => {
            const isTargetLive = liveRun && liveRun.id === run.id
            const currentRun = isTargetLive ? liveRun : run
            const steps = extractRunSteps(currentRun)
            const sessionId = extractSessionId(currentRun) ?? extractSessionId(run)
            const goalEvaluation =
                extractGoalEvaluation(currentRun) ?? extractGoalEvaluation(run)
            return {
                id: run.id,
                status: currentRun.status ?? run.status,
                createdAt: run.createdAt,
                startedAt: currentRun.startedAt ?? run.startedAt,
                finishedAt: currentRun.finishedAt ?? run.finishedAt,
                durationMs: currentRun.durationMs ?? run.durationMs,
                error: currentRun.error ?? run.error,
                steps,
                sessionId,
                isLive: isLiveStatus(currentRun.status ?? run.status),
                metadata: (currentRun as any)?.metadata as Record<string, unknown> | undefined,
                goalEvaluation,
                raw: run as ReturnType<typeof useRealtimeRunsWithTag<typeof runWorkflowTask>>["runs"][number],
            }
        })
    }, [runs, liveRun])

    const selectedRun = useMemo(() => {
        if (selectedRunId) {
            const found = workflowRuns.find((r) => r.id === selectedRunId)
            if (found) return found
        }
        return workflowRuns[0]
    }, [selectedRunId, workflowRuns])

    const selectedStep = useMemo(() => {
        if (!selectedRun) return undefined
        if (selectedStepId) {
            const found = selectedRun.steps.find((s) => s.id === selectedStepId)
            if (found) return found
        }
        return selectedRun.steps[0]
    }, [selectedRun, selectedStepId])

    const getRunSteps = useCallback(
        (
            runOrId:
                | ReturnType<typeof useRealtimeRunsWithTag<typeof runWorkflowTask>>["runs"][number]
                | string,
        ): RunStep[] => {
            if (typeof runOrId === "string") {
                const found = workflowRuns.find((r) => r.id === runOrId)
                if (found) return found.steps
                const rawFound = runs.find((r) => r.id === runOrId)
                return extractRunSteps(rawFound)
            }
            if (liveRun && liveRun.id === runOrId.id) {
                return extractRunSteps(liveRun)
            }
            return extractRunSteps(runOrId)
        },
        [workflowRuns, runs, liveRun],
    )

    const getRunSessionId = useCallback(
        (
            runOrId:
                | ReturnType<typeof useRealtimeRunsWithTag<typeof runWorkflowTask>>["runs"][number]
                | string,
        ): string | undefined => {
            if (typeof runOrId === "string") {
                const found = workflowRuns.find((r) => r.id === runOrId)
                if (found) return found.sessionId
                const rawFound = runs.find((r) => r.id === runOrId)
                return extractSessionId(rawFound)
            }
            if (liveRun && liveRun.id === runOrId.id) {
                return extractSessionId(liveRun) ?? extractSessionId(runOrId)
            }
            return extractSessionId(runOrId)
        },
        [workflowRuns, runs, liveRun],
    )

    const useLatestRunSteps = useCallback((): LatestRunSteps => {
        const currentRun = activeRun
            ? (liveRun?.id === activeRun.runId ? liveRun : undefined)
            : (targetRunId && liveRun?.id === targetRunId ? liveRun : latestTagRun)

        if (!currentRun) {
            return { steps: undefined, isLive: false }
        }

        const steps = extractRunSteps(currentRun)

        return {
            steps: steps.length > 0 ? steps : undefined,
            isLive: isLiveStatus(currentRun.status),
            runStatus: currentRun.status,
        }
    }, [activeRun, liveRun, targetRunId, latestTagRun])

    const value = useMemo<WorkflowRunsApi>(() => {
        return {
            runs,
            workflowRuns,
            error,
            activeRun,
            setActiveRun,
            selectedRunId,
            setSelectedRunId,
            selectedRun,
            selectedStepId,
            setSelectedStepId,
            selectedStep,
            getRunSteps,
            getRunSessionId,
            useLatestRunSteps,
        }
    }, [
        runs,
        workflowRuns,
        error,
        activeRun,
        selectedRunId,
        selectedRun,
        selectedStepId,
        selectedStep,
        getRunSteps,
        getRunSessionId,
        useLatestRunSteps,
    ])

    return (
        <WorkflowRunsContext.Provider value={value}>
            {children}
        </WorkflowRunsContext.Provider>
    )
}

export function useWorkflowRunsApi(): WorkflowRunsApi {
    const ctx = useContext(WorkflowRunsContext)
    if (!ctx) {
        throw new Error(
            "useWorkflowRunsApi must be used within a WorkflowRunsProvider",
        )
    }
    return ctx
}

export function useWorkflowRuns(): WorkflowRunsApi {
    return useWorkflowRunsApi()
}

export function useLatestRunSteps(): LatestRunSteps {
    return useWorkflowRunsApi().useLatestRunSteps()
}