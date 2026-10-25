import type { RunStep, GoalEvaluation } from "../../features/workflows/tasks/run-workflow.ts"

export type NotificationProvider = "telegram" | "whatsapp"

export interface TelegramConfig {
    botToken: string
    chatId: string
}

export interface WhatsAppTwilioConfig {
    accountSid: string
    authToken: string
    fromNumber: string
    toNumber: string
}

export interface WhatsAppCallMeBotConfig {
    phone: string
    apiKey: string
}

export interface WorkflowNotificationParams {
    workflowName: string
    workflowId: string
    runId: string
    durationMs: number
    steps: RunStep[]
    outputs: Record<string, unknown>
    goalEvaluation?: GoalEvaluation
    airtableSyncResult?: {
        synced: boolean
        statusAssigned?: string
        count?: number
    }
    error?: unknown
    summaryData?: Record<string, unknown>
}

export interface SendMessageResult {
    sent: boolean
    messageId?: string
    error?: string
    provider: NotificationProvider
    recipient?: string
}

export interface DispatchResult {
    sentTelegram: boolean
    sentWhatsApp: boolean
    telegramResult?: SendMessageResult
    whatsappResult?: SendMessageResult
    errors: {
        telegram?: string
        whatsapp?: string
    }
}
