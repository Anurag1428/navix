import { getTelegramConfig } from "@/lib/notifications/telegram"

/**
 * Send a plain-text or HTML reply back to any Telegram chat.
 */
export async function replyTelegram(
    chatId: number,
    text: string,
    parseMode: "HTML" | "Markdown" | null = "HTML"
): Promise<void> {
    const config = getTelegramConfig()
    if (!config) {
        console.warn("[TelegramBot] Cannot reply — TELEGRAM_BOT_TOKEN not configured.")
        return
    }

    const payload: Record<string, unknown> = {
        chat_id: chatId,
        text,
        link_preview_options: { is_disabled: true },
    }
    if (parseMode) payload.parse_mode = parseMode

    const res = await fetch(
        `https://api.telegram.org/bot${config.botToken}/sendMessage`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }
    )

    if (!res.ok) {
        const body = await res.json().catch(() => null)
        console.error("[TelegramBot] Reply failed:", body?.description ?? res.statusText)
    }
}
