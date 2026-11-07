/**
 * Telegram Bot API update types (minimal subset we need).
 */

export interface TelegramUser {
    id: number
    first_name: string
    last_name?: string
    username?: string
}

export interface TelegramChat {
    id: number
    type: "private" | "group" | "supergroup" | "channel"
}

export interface TelegramMessage {
    message_id: number
    from?: TelegramUser
    chat: TelegramChat
    date: number
    text?: string
}

export interface TelegramUpdate {
    update_id: number
    message?: TelegramMessage
    /** inline button presses (future-proofing) */
    callback_query?: {
        id: string
        from: TelegramUser
        message?: TelegramMessage
        data?: string
    }
}

export interface ParsedCommand {
    command: string
    args: string[]
    rawText: string
    chatId: number
    fromId: number
    fromName: string
}
