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

import type { runWorkflowTask, RunStep } from "@/features/workflows/tasks/run-workflow"

export type { RunStep }

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
    isLive: boolean
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
            return {
                id: run.id,
                status: currentRun.status ?? run.status,
                createdAt: run.createdAt,
                startedAt: currentRun.startedAt ?? run.startedAt,
                finishedAt: currentRun.finishedAt ?? run.finishedAt,
                durationMs: currentRun.durationMs ?? run.durationMs,
                error: currentRun.error ?? run.error,
                steps,
                isLive: isLiveStatus(currentRun.status ?? run.status),
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