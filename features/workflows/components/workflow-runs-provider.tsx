"use client"

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useRealtimeRun, useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"

import type { runWorkflowTask, RunStep } from "@/features/workflows/tasks/run-workflow"

export type ActiveRun = {
    runId: string
    publicAccessToken: string
}

export type LatestRunSteps = {
    steps: RunStep[] | undefined
    isLive: boolean
    runStatus?: string
}

export type WorkflowRunsApi = {
    runs: ReturnType<
        typeof useRealtimeRunsWithTag<typeof runWorkflowTask>
    >["runs"]
    error: Error | undefined
    activeRun: ActiveRun | null
    setActiveRun: React.Dispatch<React.SetStateAction<ActiveRun | null>>
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

function isLiveStatus(status?: string): boolean {
    if (!status) return false
    return !FINISHED_STATUSES.has(status)
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

    const { runs, error: tagError } = useRealtimeRunsWithTag<typeof runWorkflowTask>(
        `workflow:${workflowId}`,
        { accessToken: publicAccessToken },
    )

    const latestTagRun = useMemo(() => {
        return runs
            .slice()
            .sort(
                (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
            )[0]
    }, [runs])

    const targetRunId = activeRun?.runId ?? (latestTagRun && isLiveStatus(latestTagRun.status) ? latestTagRun.id : undefined)
    const targetToken = activeRun ? activeRun.publicAccessToken : publicAccessToken

    const { run: liveRun, error: liveRunError } = useRealtimeRun(targetRunId ?? "", {
        accessToken: targetToken,
        enabled: !!targetRunId,
        skipColumns: ["payload"],
    })

    const error = tagError ?? liveRunError

    const value = useMemo<WorkflowRunsApi>(() => {
        const useLatestRunSteps = (): LatestRunSteps => {
            const currentRun = activeRun
                ? (liveRun?.id === activeRun.runId ? liveRun : undefined)
                : (targetRunId && liveRun?.id === targetRunId ? liveRun : latestTagRun)

            if (!currentRun) {
                return { steps: undefined, isLive: false }
            }

            const outputSteps = (currentRun.output as { steps?: RunStep[] } | undefined)?.steps
            const metadataSteps = currentRun.metadata?.steps as RunStep[] | undefined

            const steps =
                Array.isArray(outputSteps) && outputSteps.length > 0
                    ? outputSteps
                    : metadataSteps

            return {
                steps,
                isLive: isLiveStatus(currentRun.status),
                runStatus: currentRun.status,
            }
        }

        return { runs, error, activeRun, setActiveRun, useLatestRunSteps }
    }, [runs, error, activeRun, targetRunId, liveRun, latestTagRun])

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

export function useLatestRunSteps(): LatestRunSteps {
    return useWorkflowRunsApi().useLatestRunSteps()
}