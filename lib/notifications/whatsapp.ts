import type { SendMessageResult } from "./types.ts"

const WHATSAPP_MAX_CHUNK_LENGTH = 1500

export interface SendWhatsAppOptions {
    text: string
    recipient?: string
}

export function isWhatsAppConfigured(): boolean {
    const hasTwilio = Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_WHATSAPP_NUMBER &&
        (process.env.WHATSAPP_TO_NUMBER || process.env.WHATSAPP_PHONE)
    )

    const hasCallMeBot = Boolean(
        process.env.CALLMEBOT_API_KEY &&
        (process.env.CALLMEBOT_PHONE || process.env.WHATSAPP_PHONE || process.env.WHATSAPP_TO_NUMBER)
    )

    const hasWebhook = Boolean(process.env.WHATSAPP_WEBHOOK_URL)

    return hasTwilio || hasCallMeBot || hasWebhook
}

function splitWhatsAppMessage(text: string, maxLength: number = WHATSAPP_MAX_CHUNK_LENGTH): string[] {
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

/**
 * Sends WhatsApp message via Twilio, CallMeBot, or configured Webhook.
 */
export async function sendWhatsAppMessage(options: SendWhatsAppOptions): Promise<SendMessageResult> {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID?.trim()
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN?.trim()
    const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER?.trim()
    const callmebotKey = process.env.CALLMEBOT_API_KEY?.trim()
    const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL?.trim()

    const rawRecipient =
        options.recipient?.trim() ||
        process.env.WHATSAPP_TO_NUMBER?.trim() ||
        process.env.WHATSAPP_PHONE?.trim() ||
        process.env.CALLMEBOT_PHONE?.trim()

    // 1. Try Twilio
    if (twilioSid && twilioAuth && twilioFrom && rawRecipient) {
        const fromFormatted = twilioFrom.startsWith("whatsapp:") ? twilioFrom : `whatsapp:${twilioFrom}`
        const toFormatted = rawRecipient.startsWith("whatsapp:") ? rawRecipient : `whatsapp:${rawRecipient}`

        const chunks = splitWhatsAppMessage(options.text)
        let lastId: string | undefined

        for (const chunk of chunks) {
            try {
                const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`
                const params = new URLSearchParams()
                params.append("From", fromFormatted)
                params.append("To", toFormatted)
                params.append("Body", chunk)

                const authHeader = `Basic ${Buffer.from(`${twilioSid}:${twilioAuth}`).toString("base64")}`
                const res = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                        Authorization: authHeader,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: params.toString(),
                })

                const json = await res.json().catch(() => null)
                if (!res.ok) {
                    const errDetail = json?.message || `HTTP ${res.status} ${res.statusText}`
                    console.error(`[WhatsApp/Twilio] Send failed: ${errDetail}`)
                    return {
                        provider: "whatsapp",
                        sent: false,
                        error: `Twilio Error: ${errDetail}`,
                        recipient: toFormatted,
                    }
                }

                lastId = json?.sid
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                return {
                    provider: "whatsapp",
                    sent: false,
                    error: `Twilio Network Error: ${message}`,
                    recipient: toFormatted,
                }
            }
        }

        return {
            provider: "whatsapp",
            sent: true,
            messageId: lastId,
            recipient: toFormatted,
        }
    }

    // 2. Try CallMeBot
    if (callmebotKey && rawRecipient) {
        const phone = rawRecipient.replace(/^whatsapp:/i, "").replace(/[+\s\-()]/g, "")
        const chunks = splitWhatsAppMessage(options.text)

        for (const chunk of chunks) {
            try {
                const encodedText = encodeURIComponent(chunk)
                const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodedText}&apikey=${encodeURIComponent(callmebotKey)}`

                const res = await fetch(url, { method: "GET" })
                const resText = await res.text()

                if (!res.ok || resText.toLowerCase().includes("error")) {
                    console.error(`[WhatsApp/CallMeBot] Error response: ${resText}`)
                    return {
                        provider: "whatsapp",
                        sent: false,
                        error: `CallMeBot Error: ${resText.slice(0, 150)}`,
                        recipient: phone,
                    }
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                return {
                    provider: "whatsapp",
                    sent: false,
                    error: `CallMeBot Network Error: ${message}`,
                    recipient: phone,
                }
            }
        }

        return {
            provider: "whatsapp",
            sent: true,
            recipient: phone,
        }
    }

    // 3. Try custom Webhook
    if (webhookUrl) {
        try {
            const res = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: options.text,
                    recipient: rawRecipient,
                }),
            })

            if (!res.ok) {
                return {
                    provider: "whatsapp",
                    sent: false,
                    error: `Webhook returned HTTP ${res.status}`,
                    recipient: rawRecipient,
                }
            }

            return {
                provider: "whatsapp",
                sent: true,
                recipient: rawRecipient,
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return {
                provider: "whatsapp",
                sent: false,
                error: `Webhook Error: ${message}`,
                recipient: rawRecipient,
            }
        }
    }

    return {
        provider: "whatsapp",
        sent: false,
        error: "WHATSAPP_NOT_CONFIGURED",
    }
}
