import type { TelegramUpdate, ParsedCommand } from "./types"

/**
 * Parse an incoming Telegram Update into a structured command.
 * Returns null if the message contains no bot command.
 */
export function parseTelegramCommand(update: TelegramUpdate): ParsedCommand | null {
    const message = update.message
    if (!message?.text) return null

    const text = message.text.trim()

    // Telegram bot commands always start with "/"
    if (!text.startsWith("/")) return null

    // Strip @BotName suffix that Telegram appends in groups, e.g. /run@NavixBot
    const parts = text.split(/\s+/)
    const rawCommand = parts[0].split("@")[0].toLowerCase() // e.g. "/run"
    const command = rawCommand.slice(1) // strip leading slash → "run"
    const args = parts.slice(1)

    return {
        command,
        args,
        rawText: text,
        chatId: message.chat.id,
        fromId: message.from?.id ?? 0,
        fromName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || "Unknown",
    }
}
