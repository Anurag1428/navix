import { sendWhatsAppMessage, formatWorkflowSummaryForWhatsApp } from "../../../lib/notifications/index.ts"
import type { NodeContext } from "./node-executors.ts"

export async function whatsappNode({
    values,
    nodeId,
    steps,
    outputs,
}: {
    values: Record<string, string>
    nodeId?: string
    steps?: NodeContext["steps"]
    outputs?: Record<string, unknown>
}) {
    const customMessage = values.message?.trim()
    const recipient = values.recipient?.trim()

    let textToSend: string

    if (customMessage) {
        textToSend = customMessage
    } else {
        textToSend = formatWorkflowSummaryForWhatsApp({
            workflowName: "Workflow Notification",
            workflowId: "current-run",
            runId: `step_${nodeId || "whatsapp"}`,
            durationMs: 0,
            steps: steps || [],
            outputs: outputs || {},
        })
    }

    console.log(`[WhatsApp Node] START (nodeId: ${nodeId ?? "unknown"})`)

    const result = await sendWhatsAppMessage({
        text: textToSend,
        recipient: recipient || undefined,
    })

    if (!result.sent) {
        console.error(`[WhatsApp Node] FAILED (nodeId: ${nodeId ?? "unknown"}): ${result.error}`)
        throw new Error(`WhatsApp: ${result.error}`)
    }

    console.log(
        `[WhatsApp Node] SUCCESS (nodeId: ${nodeId ?? "unknown"}, messageId: ${result.messageId ?? "unknown"})`
    )

    return {
        success: true,
        messageId: result.messageId,
        recipient: result.recipient,
    }
}
