import type { SendMessageResult, TelegramConfig } from "./types.ts"

const TELEGRAM_MAX_MESSAGE_LENGTH = 4000

export function getTelegramConfig(): TelegramConfig | null {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim()

    if (!botToken || !chatId) {
        return null
    }

    return { botToken, chatId }
}

export function isTelegramConfigured(): boolean {
    return getTelegramConfig() !== null
}

/**
 * Splits long text into chunks that satisfy Telegram's 4096-character limit.
 */
function splitTelegramMessage(text: string, maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
    if (text.length <= maxLength) {
        return [text]
    }

    const chunks: string[] = []
    const lines = text.split("\n")
    let currentChunk = ""

    for (const line of lines) {
        if ((currentChunk + "\n" + line).length > maxLength) {
            if (currentChunk.trim().length > 0) {
                chunks.push(currentChunk.trim())
                currentChunk = ""
            }

            if (line.length > maxLength) {
                for (let i = 0; i < line.length; i += maxLength) {
                    chunks.push(line.slice(i, i + maxLength))
                }
            } else {
                currentChunk = line
            }
        } else {
            currentChunk = currentChunk ? currentChunk + "\n" + line : line
        }
    }

    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim())
    }

    return chunks
}

export interface SendTelegramOptions {
    text: string
    chatId?: string
    botToken?: string
    parseMode?: "HTML" | "Markdown" | "MarkdownV2" | null
}

/**
 * Sends one or more messages to a Telegram chat.
 */
export async function sendTelegramMessage(options: SendTelegramOptions): Promise<SendMessageResult> {
    const envConfig = getTelegramConfig()
    const botToken = options.botToken?.trim() || envConfig?.botToken
    const chatId = options.chatId?.trim() || envConfig?.chatId

    if (!botToken || !chatId) {
        return {
            provider: "telegram",
            sent: false,
            error: "TELEGRAM_NOT_CONFIGURED: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.",
        }
    }

    const chunks = splitTelegramMessage(options.text)
    let lastMessageId: string | undefined

    for (const chunk of chunks) {
        const payload: Record<string, unknown> = {
            chat_id: chatId,
            text: chunk,
            link_preview_options: { is_disabled: true },
        }

        if (options.parseMode !== null) {
            payload.parse_mode = options.parseMode || "HTML"
        }

        try {
            const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`
            let response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })

            let result = await response.json().catch(() => null)

            // If HTML entity parsing fails, fallback immediately to plain text
            if (!response.ok && payload.parse_mode && result?.description?.includes("can't parse entities")) {
                console.warn("[Telegram] HTML entity error, retrying as plain text...")
                delete payload.parse_mode
                response = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                })
                result = await response.json().catch(() => null)
            }

            if (!response.ok) {
                const errorDescription = result?.description || `HTTP ${response.status} ${response.statusText}`
                console.error(`[Telegram] Send failed: ${errorDescription}`)
                return {
                    provider: "telegram",
                    sent: false,
                    error: `Telegram API Error: ${errorDescription}`,
                    recipient: chatId,
                }
            }

            lastMessageId = String(result?.result?.message_id || "")
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`[Telegram] Network error sending message: ${message}`)
            return {
                provider: "telegram",
                sent: false,
                error: `Telegram Network Error: ${message}`,
                recipient: chatId,
            }
        }
    }

    return {
        provider: "telegram",
        sent: true,
        messageId: lastMessageId,
        recipient: chatId,
    }
}
