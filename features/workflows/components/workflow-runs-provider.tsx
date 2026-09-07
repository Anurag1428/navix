"use client"

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react"
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"

import type { runWorkflowTask, RunStep } from "@/features/workflows/tasks/run-workflow"

type LatestRunSteps = {
    steps: RunStep[] | undefined
    isLive: boolean
}

type WorkflowRunsApi = {
    runs: ReturnType<
        typeof useRealtimeRunsWithTag<typeof runWorkflowTask>
    >["runs"]
    error: Error | undefined
    useLatestRunSteps: () => LatestRunSteps
}

const WorkflowRunsContext = createContext<WorkflowRunsApi | null>(null)

const LIVE_STATUSES = new Set([
    "QUEUED",
    "EXECUTING",
    "REATTEMPTING",
    "DELAYED",
])

export function WorkflowRunsProvider({
    workflowId,
    publicAccessToken,
    children,
}: {
    workflowId: string
    publicAccessToken: string
    children: ReactNode
}) {
    const { runs, error } = useRealtimeRunsWithTag<typeof runWorkflowTask>(
        `workflow:${workflowId}`,
        { accessToken: publicAccessToken },
    )

    const value = useMemo<WorkflowRunsApi>(() => {
        const useLatestRunSteps = (): LatestRunSteps => {
            const latest = runs
                .slice()
                .sort(
                    (a, b) =>
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime(),
                )[0]

            if (!latest) {
                return { steps: undefined, isLive: false }
            }

            const outputSteps = (latest.output as { steps?: RunStep[] } | undefined)
                ?.steps
            const metadataSteps = latest.metadata?.steps as
                | RunStep[]
                | undefined

            const steps =
                Array.isArray(outputSteps) && outputSteps.length > 0
                    ? outputSteps
                    : metadataSteps

            return {
                steps,
                isLive: LIVE_STATUSES.has(latest.status),
            }
        }

        return { runs, error, useLatestRunSteps }
    }, [runs, error])

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