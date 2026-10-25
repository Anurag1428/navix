import type { WorkflowNotificationParams } from "./types.ts"
import { formatDuration } from "../../features/workflows/tasks/workflow-summary.ts"

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

type ExtractedJobData = {
    confirmedList: Array<{ company: string; role?: string; evidence?: string }>
    attemptedList: Array<{ company: string; role?: string }>
    skippedList: Array<{ company: string; role?: string; reason?: string }>
    airtablePreloadedList: Array<{ company: string; role?: string }>
}

function extractJobsFromOutputs(outputs: Record<string, unknown>): ExtractedJobData {
    const confirmedList: Array<{ company: string; role?: string; evidence?: string }> = []
    const attemptedList: Array<{ company: string; role?: string }> = []
    const skippedList: Array<{ company: string; role?: string; reason?: string }> = []
    const airtablePreloadedList: Array<{ company: string; role?: string }> = []

    for (const out of Object.values(outputs)) {
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

    return { confirmedList, attemptedList, skippedList, airtablePreloadedList }
}

/**
 * Formats workflow execution report for Telegram using clean HTML tags.
 */
export function formatWorkflowSummaryForTelegram(params: WorkflowNotificationParams): string {
    const isSuccess = !params.error && params.goalEvaluation?.status !== "failed"
    const statusEmoji = isSuccess ? "✅" : "❌"
    const statusText = isSuccess ? "COMPLETED" : "FAILED"
    const duration = formatDuration(params.durationMs)
    const { confirmedList, attemptedList, skippedList } = extractJobsFromOutputs(params.outputs)

    const lines: string[] = []

    lines.push(`🚀 <b>NAVIX WORKFLOW REPORT</b>`)
    lines.push(`━━━━━━━━━━━━━━━━━━━━━`)
    lines.push(`📋 <b>Workflow:</b> ${escapeHtml(params.workflowName)}`)
    lines.push(`🆔 <b>Run ID:</b> <code>${escapeHtml(params.runId)}</code>`)
    lines.push(`📊 <b>Status:</b> ${statusEmoji} <b>${statusText}</b>`)
    lines.push(`⏱️ <b>Duration:</b> ${duration}`)

    // Executed steps
    if (params.steps && params.steps.length > 0) {
        lines.push(``)
        lines.push(`🔹 <b>Steps Executed (${params.steps.length}):</b>`)
        params.steps.forEach((step, idx) => {
            const icon =
                step.status === "done"
                    ? "✅"
                    : step.status === "failed"
                      ? "❌"
                      : "⏳"
            const dur = step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : "-"
            lines.push(`  ${idx + 1}. ${escapeHtml(step.title)} — ${icon} (${dur})`)
        })
    }

    // Job application outcomes (if applicable)
    if (confirmedList.length > 0 || attemptedList.length > 0 || skippedList.length > 0) {
        lines.push(``)
        lines.push(`💼 <b>Job Applications:</b>`)
        if (confirmedList.length > 0) {
            lines.push(`  • <b>Confirmed (${confirmedList.length}):</b>`)
            for (const c of confirmedList) {
                const roleStr = c.role ? ` — ${escapeHtml(c.role)}` : ""
                lines.push(`    ▫️ <b>${escapeHtml(c.company)}</b>${roleStr}`)
                if (c.evidence) {
                    lines.push(`       <i>Proof: ${escapeHtml(c.evidence)}</i>`)
                }
            }
        }
        if (attemptedList.length > 0) {
            lines.push(`  • <b>Attempted / Pending (${attemptedList.length}):</b>`)
            for (const a of attemptedList) {
                const roleStr = a.role ? ` — ${escapeHtml(a.role)}` : ""
                lines.push(`    ▫️ ${escapeHtml(a.company)}${roleStr}`)
            }
        }
        if (skippedList.length > 0) {
            lines.push(`  • <b>Skipped (${skippedList.length}):</b>`)
            for (const s of skippedList) {
                const roleStr = s.role ? ` — ${escapeHtml(s.role)}` : ""
                const reasonStr = s.reason ? ` (${escapeHtml(s.reason)})` : ""
                lines.push(`    ▫️ ${escapeHtml(s.company)}${roleStr}${reasonStr}`)
            }
        }
    }

    // Goal evaluation / verification
    if (params.goalEvaluation) {
        lines.push(``)
        const goalVerdict = params.goalEvaluation.achieved ? "✅ ACHIEVED" : `⚠️ ${params.goalEvaluation.status?.toUpperCase() || "UNVERIFIED"}`
        lines.push(`🎯 <b>Goal Verdict:</b> ${goalVerdict}`)
        if (params.goalEvaluation.summary) {
            lines.push(`  • <i>${escapeHtml(params.goalEvaluation.summary)}</i>`)
        }
        if (params.goalEvaluation.evidence) {
            lines.push(`  • <b>Evidence:</b> <code>${escapeHtml(params.goalEvaluation.evidence)}</code>`)
        }
    }

    // Airtable Sync status
    if (params.airtableSyncResult) {
        lines.push(``)
        const airtableIcon = params.airtableSyncResult.synced ? "✅" : "ℹ️"
        lines.push(`🗄️ <b>Airtable:</b> ${airtableIcon} ${params.airtableSyncResult.synced ? "Synced" : "Not Synced"} (${escapeHtml(params.airtableSyncResult.statusAssigned || "No records")})`)
    }

    // Error details (if failed)
    if (params.error) {
        lines.push(``)
        lines.push(`❌ <b>FAILURE DETAILS:</b>`)
        const errMsg = params.error instanceof Error ? params.error.message : String(params.error)
        lines.push(`<code>${escapeHtml(errMsg)}</code>`)
    }

    lines.push(`━━━━━━━━━━━━━━━━━━━━━`)
    return lines.join("\n")
}

/**
 * Formats workflow execution report for WhatsApp using WhatsApp markdown (*bold*, _italic_).
 */
export function formatWorkflowSummaryForWhatsApp(params: WorkflowNotificationParams): string {
    const isSuccess = !params.error && params.goalEvaluation?.status !== "failed"
    const statusEmoji = isSuccess ? "✅" : "❌"
    const statusText = isSuccess ? "COMPLETED" : "FAILED"
    const duration = formatDuration(params.durationMs)
    const { confirmedList, attemptedList, skippedList } = extractJobsFromOutputs(params.outputs)

    const lines: string[] = []

    lines.push(`🚀 *NAVIX WORKFLOW REPORT*`)
    lines.push(`━━━━━━━━━━━━━━━━━━━━━`)
    lines.push(`📋 *Workflow:* ${params.workflowName}`)
    lines.push(`🆔 *Run ID:* ${params.runId}`)
    lines.push(`📊 *Status:* ${statusEmoji} *${statusText}*`)
    lines.push(`⏱️ *Duration:* ${duration}`)

    // Executed steps
    if (params.steps && params.steps.length > 0) {
        lines.push(``)
        lines.push(`🔹 *Steps Executed (${params.steps.length}):*`)
        params.steps.forEach((step, idx) => {
            const icon =
                step.status === "done"
                    ? "✅"
                    : step.status === "failed"
                      ? "❌"
                      : "⏳"
            const dur = step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : "-"
            lines.push(`  ${idx + 1}. ${step.title} — ${icon} (${dur})`)
        })
    }

    // Job application outcomes (if applicable)
    if (confirmedList.length > 0 || attemptedList.length > 0 || skippedList.length > 0) {
        lines.push(``)
        lines.push(`💼 *Job Applications:*`)
        if (confirmedList.length > 0) {
            lines.push(`  • *Confirmed (${confirmedList.length}):*`)
            for (const c of confirmedList) {
                const roleStr = c.role ? ` — ${c.role}` : ""
                lines.push(`    ▫️ *${c.company}*${roleStr}`)
                if (c.evidence) {
                    lines.push(`       _Proof: ${c.evidence}_`)
                }
            }
        }
        if (attemptedList.length > 0) {
            lines.push(`  • *Attempted / Pending (${attemptedList.length}):*`)
            for (const a of attemptedList) {
                const roleStr = a.role ? ` — ${a.role}` : ""
                lines.push(`    ▫️ ${a.company}${roleStr}`)
            }
        }
        if (skippedList.length > 0) {
            lines.push(`  • *Skipped (${skippedList.length}):*`)
            for (const s of skippedList) {
                const roleStr = s.role ? ` — ${s.role}` : ""
                const reasonStr = s.reason ? ` (${s.reason})` : ""
                lines.push(`    ▫️ ${s.company}${roleStr}${reasonStr}`)
            }
        }
    }

    // Goal evaluation / verification
    if (params.goalEvaluation) {
        lines.push(``)
        const goalVerdict = params.goalEvaluation.achieved ? "✅ ACHIEVED" : `⚠️ ${params.goalEvaluation.status?.toUpperCase() || "UNVERIFIED"}`
        lines.push(`🎯 *Goal Verdict:* ${goalVerdict}`)
        if (params.goalEvaluation.summary) {
            lines.push(`  • _${params.goalEvaluation.summary}_`)
        }
        if (params.goalEvaluation.evidence) {
            lines.push(`  • Evidence: ${params.goalEvaluation.evidence}`)
        }
    }

    // Airtable Sync status
    if (params.airtableSyncResult) {
        lines.push(``)
        const airtableIcon = params.airtableSyncResult.synced ? "✅" : "ℹ️"
        lines.push(`🗄️ *Airtable:* ${airtableIcon} ${params.airtableSyncResult.synced ? "Synced" : "Not Synced"} (${params.airtableSyncResult.statusAssigned || "No records"})`)
    }

    // Error details (if failed)
    if (params.error) {
        lines.push(``)
        lines.push(`❌ *FAILURE DETAILS:*`)
        const errMsg = params.error instanceof Error ? params.error.message : String(params.error)
        lines.push(`Error: ${errMsg}`)
    }

    lines.push(`━━━━━━━━━━━━━━━━━━━━━`)
    return lines.join("\n")
}
