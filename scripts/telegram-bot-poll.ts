import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })
dotenv.config({ path: ".env" })

import { parseTelegramCommand } from "../lib/telegram-bot/parser.ts"
import { getTelegramConfig } from "../lib/notifications/telegram.ts"
import type { TelegramUpdate } from "../lib/telegram-bot/types.ts"

/**
 * Local Development Bot Poller (Long-Polling Mode)
 *
 * Why use this in development?
 * - No public URL, domain, or ngrok required!
 * - Outgoing connection directly to Telegram.
 * - Perfect when lying in bed while your laptop is running on your desk!
 */
async function startBotPolling() {
    const config = getTelegramConfig()
    if (!config) {
        console.error("❌ TELEGRAM_BOT_TOKEN is not configured in .env.local")
        process.exit(1)
    }

    const orgId = process.env.NAVIX_ORG_ID
    if (!orgId) {
        console.error("❌ NAVIX_ORG_ID is not configured in .env.local")
        process.exit(1)
    }

    // Dynamic import to ensure process.env.DATABASE_URL is populated before DB connection initializes
    const { handleBotCommand } = await import("../lib/telegram-bot/command-handler.ts")

    console.log("==================================================")
    console.log("  🤖 Navix Telegram Remote Control (Local Polling)")
    console.log("==================================================")
    console.log(`✅ Bot Token: Configured`)
    console.log(`✅ Target Org ID: ${orgId}`)
    console.log("📡 Listening for commands from your phone...")
    console.log("👉 Send /list or /run <workflow-name> from Telegram!\n")

    // Delete any webhook so Telegram switches to getUpdates polling mode
    try {
        await fetch(`https://api.telegram.org/bot${config.botToken}/deleteWebhook`)
    } catch {}

    let offset = 0
    let isRunning = true

    process.on("SIGINT", () => {
        console.log("\n🛑 Stopping polling...")
        isRunning = false
        process.exit(0)
    })

    while (isRunning) {
        try {
            const endpoint = `https://api.telegram.org/bot${config.botToken}/getUpdates?offset=${offset}&timeout=25`
            const res = await fetch(endpoint)
            if (!res.ok) {
                await new Promise((r) => setTimeout(r, 3000))
                continue
            }

            const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] }
            if (data.ok && Array.isArray(data.result)) {
                for (const update of data.result) {
                    offset = update.update_id + 1

                    const parsed = parseTelegramCommand(update)
                    if (parsed) {
                        console.log(`\n📨 Received command: /${parsed.command} from ${parsed.fromName} (chat: ${parsed.chatId})`)
                        console.log(`   Args: ${parsed.args.join(" ") || "(none)"}`)

                        // Execute command asynchronously
                        handleBotCommand(parsed, orgId).catch((err) => {
                            console.error("   ❌ Error executing command:", err)
                        })
                    }
                }
            }
        } catch {
            await new Promise((r) => setTimeout(r, 2000))
        }
    }
}

startBotPolling().catch((err) => {
    console.error("Fatal poller error:", err)
    process.exit(1)
})
