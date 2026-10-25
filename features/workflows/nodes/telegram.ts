import { sendTelegramMessage, formatWorkflowSummaryForTelegram } from "../../../lib/notifications/index.ts"
import type { NodeContext } from "./node-executors.ts"

export async function telegramNode({
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
    const chatId = values.chatId?.trim()

    let textToSend: string
    let parseMode: "HTML" | null = "HTML"

    if (customMessage) {
        textToSend = customMessage
        parseMode = customMessage.includes("<") && customMessage.includes(">") ? "HTML" : null
    } else {
        textToSend = formatWorkflowSummaryForTelegram({
            workflowName: "Workflow Notification",
            workflowId: "current-run",
            runId: `step_${nodeId || "telegram"}`,
            durationMs: 0,
            steps: steps || [],
            outputs: outputs || {},
        })
    }

    console.log(`[Telegram Node] START (nodeId: ${nodeId ?? "unknown"})`)

    const result = await sendTelegramMessage({
        text: textToSend,
        chatId: chatId || undefined,
        parseMode,
    })

    if (!result.sent) {
        console.error(`[Telegram Node] FAILED (nodeId: ${nodeId ?? "unknown"}): ${result.error}`)
        throw new Error(`Telegram: ${result.error}`)
    }

    console.log(
        `[Telegram Node] SUCCESS (nodeId: ${nodeId ?? "unknown"}, messageId: ${result.messageId ?? "unknown"})`
    )

    return {
        success: true,
        messageId: result.messageId,
        recipient: result.recipient,
    }
}
