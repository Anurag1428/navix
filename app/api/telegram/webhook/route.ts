import { type NextRequest, NextResponse } from "next/server"
import { parseTelegramCommand } from "@/lib/telegram-bot/parser"
import { handleBotCommand } from "@/lib/telegram-bot/command-handler"
import { replyTelegram } from "@/lib/telegram-bot/reply"
import type { TelegramUpdate } from "@/lib/telegram-bot/types"

/**
 * Telegram sends updates to this webhook via POST.
 *
 * Security: Telegram signs requests with a secret token header.
 * We verify it against TELEGRAM_WEBHOOK_SECRET before processing.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
    // 1. Verify the secret token Telegram passes in the header
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (webhookSecret) {
        const incoming = req.headers.get("x-telegram-bot-api-secret-token")
        if (incoming !== webhookSecret) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }
    }

    // 2. Validate required env vars
    const orgId = process.env.NAVIX_ORG_ID
    if (!orgId) {
        console.error("[TelegramWebhook] NAVIX_ORG_ID is not set — cannot look up workflows.")
        return NextResponse.json({ ok: true }) // still 200 so Telegram doesn't retry
    }

    // 3. Parse the update body
    let update: TelegramUpdate
    try {
        update = (await req.json()) as TelegramUpdate
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    // 4. Parse command (non-commands are silently ignored)
    const parsed = parseTelegramCommand(update)
    if (!parsed) {
        // Not a command — ignore but acknowledge
        return NextResponse.json({ ok: true })
    }

    // 5. Dispatch to command handler (fire-and-forget so Telegram doesn't time out)
    //    We respond 200 immediately and process async.
    handleBotCommand(parsed, orgId).catch((err) => {
        console.error("[TelegramWebhook] Command handler error:", err)
        replyTelegram(
            parsed.chatId,
            `💥 An unexpected error occurred. Please try again.`
        ).catch(() => {})
    })

    return NextResponse.json({ ok: true })
}
