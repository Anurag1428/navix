import type { RunStep, GoalEvaluation } from "./run-workflow"

export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (minutes > 0) {
        return `${minutes}m ${seconds}s (${(ms / 1000).toFixed(1)}s)`
    }
    return `${(ms / 1000).toFixed(1)}s`
}

export function buildWorkflowSummary(params: {
    workflowName: string
    workflowId: string
    runId: string
    durationMs: number
    steps: RunStep[]
    outputs: Record<string, unknown>
    goalEvaluation?: GoalEvaluation
    airtableSyncResult?: { synced: boolean; statusAssigned?: string; count?: number }
    error?: unknown
}): { text: string; data: Record<string, unknown> } {
    const isSuccess = !params.error
    const statusText = isSuccess ? "COMPLETED" : "FAILED"

    const confirmedList: Array<{ company: string; role: string; evidence?: string }> = []
    const attemptedList: Array<{ company: string; role: string }> = []
    const skippedList: Array<{ company: string; role: string; reason?: string }> = []
    const airtablePreloadedList: Array<{ company: string; role?: string }> = []

    for (const out of Object.values(params.outputs)) {
        if (!out || typeof out !== "object") continue
        const anyOut = out as any
        if (Array.isArray(anyOut.confirmedJobs)) {
            for (const j of anyOut.confirmedJobs) {
                if (j && j.company) confirmedList.push(j)
            }
        }
        if (Array.isArray(anyOut.attemptedJobs)) {
            for (const j of anyOut.attemptedJobs) {
                if (j && j.company) attemptedList.push(j)
            }
        }
        if (Array.isArray(anyOut.skippedJobs)) {
            for (const j of anyOut.skippedJobs) {
                if (j && j.company) skippedList.push(j)
            }
        }
        if (Array.isArray(anyOut.airtableRecentApplications)) {
            for (const j of anyOut.airtableRecentApplications) {
                if (j && j.company) airtablePreloadedList.push(j)
            }
        }
    }

    const stepLines = params.steps.map((s, idx) => {
        const dur = s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : "-"
        const icon = s.status === "done" ? "[DONE]" : s.status === "failed" ? "[FAILED]" : `[${s.status.toUpperCase()}]`
        return `  ${idx + 1}. ${s.title.padEnd(28)} ${icon.padEnd(9)} (${dur})`
    })

    let jobsSection = ""
    if (confirmedList.length > 0) {
        jobsSection += `• Confirmed Applications (${confirmedList.length}):\n`
        for (const c of confirmedList) {
            jobsSection += `  - ${c.company} - ${c.role || "Role"} | Evidence: ${c.evidence || "Verified on page"}\n`
        }
    } else {
        jobsSection += `• Confirmed Applications: 0\n`
    }

    if (attemptedList.length > 0) {
        jobsSection += `• Attempted Applications (${attemptedList.length}):\n`
        for (const a of attemptedList) {
            jobsSection += `  - ${a.company} - ${a.role || "Role"} | Status: unresolved/pending confirmation\n`
        }
    }

    if (skippedList.length > 0) {
        jobsSection += `• Disqualified / Skipped Listings (${skippedList.length}):\n`
        for (const s of skippedList) {
            jobsSection += `  - ${s.company} - ${s.role || "Role"}: ${s.reason || "Disqualified (criteria mismatch)"}\n`
        }
    }

    if (airtablePreloadedList.length > 0) {
        jobsSection += `• Airtable Preloaded Deduplications (${airtablePreloadedList.length} jobs already applied in last 3 days):\n`
        const sample = airtablePreloadedList.slice(0, 5).map((a) => a.company).join(", ")
        jobsSection += `  - ${sample}${airtablePreloadedList.length > 5 ? ` and ${airtablePreloadedList.length - 5} more` : ""}\n`
    }

    let errorSection = ""
    if (params.error) {
        const errMsg = params.error instanceof Error ? params.error.message : String(params.error)
        errorSection = `\n--- FAILURE DETAILS ---\nError: ${errMsg}\n`
    }

    const banner = [
        "================================================================================",
        "                         NAVIX WORKFLOW EXECUTION SUMMARY                       ",
        "================================================================================",
        `Workflow:        ${params.workflowName} (${params.workflowId})`,
        `Run ID:          ${params.runId}`,
        `Overall Status:  ${statusText}`,
        `Duration:        ${formatDuration(params.durationMs)}`,
        "",
        `--- STEPS EXECUTED (${params.steps.length}) ---`,
        stepLines.length > 0 ? stepLines.join("\n") : "  (none)",
        "",
        "--- JOB APPLICATION OUTCOMES ---",
        jobsSection.trimEnd(),
        "",
        "--- GOAL AUDIT & VERIFICATION ---",
        `Verdict:         ${params.goalEvaluation?.status || "N/A"} (Achieved: ${params.goalEvaluation?.achieved ? "Yes" : "No"})`,
        `Summary:         ${params.goalEvaluation?.summary || "N/A"}`,
        params.goalEvaluation?.evidence ? `Evidence:        ${params.goalEvaluation.evidence}` : "",
        errorSection.trimEnd(),
        "",
        "--- AIRTABLE SYNCHRONIZATION ---",
        `Synced:          ${params.airtableSyncResult?.synced ? "Yes" : "No"} (${params.airtableSyncResult?.statusAssigned || "No new records created"})`,
        "================================================================================",
    ]
        .filter((line) => line !== undefined && line !== null)
        .join("\n")

    const data: Record<string, unknown> = {
        workflowName: params.workflowName,
        workflowId: params.workflowId,
        runId: params.runId,
        status: statusText,
        durationMs: params.durationMs,
        durationFormatted: formatDuration(params.durationMs),
        stepCount: params.steps.length,
        steps: params.steps.map((s) => ({
            id: s.id,
            title: s.title,
            nodeType: s.nodeType,
            status: s.status,
            durationMs: s.durationMs,
        })),
        confirmedCount: confirmedList.length,
        attemptedCount: attemptedList.length,
        skippedCount: skippedList.length,
        airtableDeduplicatedCount: airtablePreloadedList.length,
        confirmedJobs: confirmedList,
        attemptedJobs: attemptedList,
        skippedJobs: skippedList,
        goalEvaluation: params.goalEvaluation,
        airtableSync: params.airtableSyncResult,
        error: params.error ? (params.error instanceof Error ? params.error.message : String(params.error)) : undefined,
    }

    return { text: banner, data }
}
