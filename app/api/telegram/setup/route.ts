import { type NextRequest, NextResponse } from "next/server"
import { getTelegramConfig } from "@/lib/notifications/telegram"

/**
 * One-shot route to register (or update) the Telegram webhook URL.
 *
 * Call once after deploy:
 *   GET /api/telegram/setup?secret=<TELEGRAM_SETUP_SECRET>
 *
 * Requires env vars:
 *   TELEGRAM_BOT_TOKEN          — your bot token from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET     — random secret Telegram will pass back for verification
 *   TELEGRAM_SETUP_SECRET       — protects this endpoint from public access
 *   NEXT_PUBLIC_APP_URL         — your deployed domain, e.g. https://navix.yourdomain.com
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
    // Guard: require a setup secret so random people can't call this
    const setupSecret = process.env.TELEGRAM_SETUP_SECRET
    if (setupSecret) {
        const provided = req.nextUrl.searchParams.get("secret")
        if (provided !== setupSecret) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }
    }

    const config = getTelegramConfig()
    if (!config) {
        return NextResponse.json(
            { error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured." },
            { status: 500 }
        )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "")
    if (!appUrl) {
        return NextResponse.json(
            { error: "NEXT_PUBLIC_APP_URL is not set." },
            { status: 500 }
        )
    }

    const webhookUrl = `${appUrl}/api/telegram/webhook`
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET

    const body: Record<string, unknown> = { url: webhookUrl }
    if (webhookSecret) body.secret_token = webhookSecret

    const res = await fetch(
        `https://api.telegram.org/bot${config.botToken}/setWebhook`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }
    )
    const data = await res.json()

    if (!data.ok) {
        return NextResponse.json({ error: data.description }, { status: 500 })
    }

    return NextResponse.json({
        ok: true,
        message: "Telegram webhook registered successfully!",
        webhookUrl,
        telegramResponse: data,
    })
}
