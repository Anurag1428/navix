import type { DispatchResult, WorkflowNotificationParams } from "./types.ts"
import { isTelegramConfigured, sendTelegramMessage } from "./telegram.ts"
import { isWhatsAppConfigured, sendWhatsAppMessage } from "./whatsapp.ts"
import {
    formatWorkflowSummaryForTelegram,
    formatWorkflowSummaryForWhatsApp,
} from "./formatters.ts"

export * from "./types.ts"
export * from "./telegram.ts"
export * from "./whatsapp.ts"
export * from "./formatters.ts"

/**
 * Dispatches workflow execution outcome notifications to all configured channels (Telegram, WhatsApp).
 */
export async function dispatchWorkflowNotification(
    params: WorkflowNotificationParams
): Promise<DispatchResult> {
    const result: DispatchResult = {
        sentTelegram: false,
        sentWhatsApp: false,
        errors: {},
    }

    const hasTelegram = isTelegramConfigured()
    const hasWhatsApp = isWhatsAppConfigured()

    if (!hasTelegram && !hasWhatsApp) {
        console.log(
            "[Notifications] Neither Telegram nor WhatsApp configured. Set TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID in .env.local to receive notifications."
        )
        return result
    }

    // 1. Dispatch Telegram notification if configured
    if (hasTelegram) {
        try {
            const formattedTelegram = formatWorkflowSummaryForTelegram(params)
            const tgRes = await sendTelegramMessage({
                text: formattedTelegram,
                parseMode: "HTML",
            })
            result.telegramResult = tgRes
            result.sentTelegram = tgRes.sent
            if (tgRes.sent) {
                console.log(`[Notifications] ✅ Sent workflow execution report to Telegram chat ${tgRes.recipient || ""}`)
            } else {
                result.errors.telegram = tgRes.error
                console.warn(`[Notifications] ⚠️ Telegram dispatch failed: ${tgRes.error}`)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            result.errors.telegram = msg
            console.warn(`[Notifications] ⚠️ Telegram dispatch error: ${msg}`)
        }
    }

    // 2. Dispatch WhatsApp notification if configured
    if (hasWhatsApp) {
        try {
            const formattedWhatsApp = formatWorkflowSummaryForWhatsApp(params)
            const waRes = await sendWhatsAppMessage({
                text: formattedWhatsApp,
            })
            result.whatsappResult = waRes
            result.sentWhatsApp = waRes.sent
            if (waRes.sent) {
                console.log(`[Notifications] ✅ Sent workflow execution report to WhatsApp recipient ${waRes.recipient || ""}`)
            } else {
                result.errors.whatsapp = waRes.error
                console.warn(`[Notifications] ⚠️ WhatsApp dispatch failed: ${waRes.error}`)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            result.errors.whatsapp = msg
            console.warn(`[Notifications] ⚠️ WhatsApp dispatch error: ${msg}`)
        }
    }

    return result
}
