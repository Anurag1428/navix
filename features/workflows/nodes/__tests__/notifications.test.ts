import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

import {
    formatWorkflowSummaryForTelegram,
    formatWorkflowSummaryForWhatsApp,
    isTelegramConfigured,
    isWhatsAppConfigured,
    sendTelegramMessage,
    sendWhatsAppMessage,
    dispatchWorkflowNotification,
} from "../../../../lib/notifications/index.ts"
import { telegramNode } from "../telegram.ts"
import { whatsappNode } from "../whatsapp.ts"
import type { RunStep } from "../../tasks/run-workflow.ts"

describe("Telegram & WhatsApp Workflow Notifications", () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
        delete process.env.TELEGRAM_BOT_TOKEN
        delete process.env.TELEGRAM_CHAT_ID
        delete process.env.TWILIO_ACCOUNT_SID
        delete process.env.TWILIO_AUTH_TOKEN
        delete process.env.TWILIO_WHATSAPP_NUMBER
        delete process.env.WHATSAPP_TO_NUMBER
        delete process.env.CALLMEBOT_PHONE
        delete process.env.CALLMEBOT_API_KEY
        delete process.env.WHATSAPP_WEBHOOK_URL
    })

    afterEach(() => {
        process.env = { ...originalEnv }
    })

    describe("1. Notification Formatters", () => {
        const mockSteps: RunStep[] = [
            {
                id: "step_1",
                nodeId: "open-url_1",
                nodeType: "open-url",
                title: "Open Job Board",
                status: "done",
                durationMs: 1500,
            },
            {
                id: "step_2",
                nodeId: "agent_1",
                nodeType: "agent",
                title: "Apply on Lever",
                status: "done",
                durationMs: 25000,
            },
            {
                id: "step_3",
                nodeId: "verify_1",
                nodeType: "verify",
                title: "Verify Submission",
                status: "done",
                durationMs: 2200,
            },
        ]

        const mockOutputs = {
            agent_1: {
                confirmedJobs: [
                    { company: "Acme Inc", role: "Software Engineer", evidence: "Application received page" },
                ],
                skippedJobs: [
                    { company: "OldCo", role: "Manager", reason: "Requires 10 years experience" },
                ],
            },
        }

        it("formats Telegram summary in valid HTML with emojis and step breakdown", () => {
            const report = formatWorkflowSummaryForTelegram({
                workflowName: "Job Application Flow",
                workflowId: "wf_123",
                runId: "run_abc",
                durationMs: 28700,
                steps: mockSteps,
                outputs: mockOutputs,
                goalEvaluation: {
                    achieved: true,
                    status: "achieved",
                    summary: "Successfully submitted application to Acme Inc",
                    evidence: "Confirmation modal detected",
                },
                airtableSyncResult: {
                    synced: true,
                    statusAssigned: "Applied",
                },
            })

            assert.ok(report.includes("NAVIX WORKFLOW REPORT"), "Must include banner title")
            assert.ok(report.includes("Job Application Flow"), "Must include workflow name")
            assert.ok(report.includes("run_abc"), "Must include run ID")
            assert.ok(report.includes("COMPLETED"), "Must report COMPLETED status")
            assert.ok(report.includes("Acme Inc"), "Must include confirmed job")
            assert.ok(report.includes("Software Engineer"), "Must include role")
            assert.ok(report.includes("OldCo"), "Must include skipped job")
            assert.ok(report.includes("Open Job Board"), "Must include step 1")
            assert.ok(report.includes("Apply on Lever"), "Must include step 2")
            assert.ok(report.includes("<b>"), "Must contain Telegram HTML bold tags")
            assert.ok(report.includes("<code>run_abc</code>"), "Must wrap runId in code tags")
        })

        it("escapes dangerous HTML characters in Telegram reports to prevent parse errors", () => {
            const report = formatWorkflowSummaryForTelegram({
                workflowName: "Search <Special> & 'Characters'",
                workflowId: "wf_456",
                runId: "run_xyz",
                durationMs: 5000,
                steps: [],
                outputs: {},
                error: new Error("Failed <query> & selector > timeout"),
            })

            assert.ok(report.includes("&lt;Special&gt; &amp; 'Characters'"), "Escapes HTML in workflow name")
            assert.ok(report.includes("&lt;query&gt; &amp; selector &gt; timeout"), "Escapes HTML in error")
            assert.ok(report.includes("FAILED"), "Reports FAILED status on error")
        })

        it("formats WhatsApp summary using standard WhatsApp markdown (*bold*, _italic_)", () => {
            const report = formatWorkflowSummaryForWhatsApp({
                workflowName: "Stripe Automated Applier",
                workflowId: "wf_789",
                runId: "run_stripe_01",
                durationMs: 12400,
                steps: mockSteps,
                outputs: mockOutputs,
                goalEvaluation: {
                    achieved: true,
                    status: "achieved",
                    summary: "Submitted candidate profile to Stripe",
                },
            })

            assert.ok(report.includes("*NAVIX WORKFLOW REPORT*"), "Uses WhatsApp bold format")
            assert.ok(report.includes("Stripe Automated Applier"), "Includes workflow name")
            assert.ok(report.includes("*Acme Inc*"), "Bolds company name")
            assert.ok(report.includes("_Proof: Application received page_"), "Italicizes evidence proof")
            assert.ok(report.includes("✅ ACHIEVED"), "Includes goal verdict")
        })
    })

    describe("2. Configuration Verification", () => {
        it("returns false for isTelegramConfigured when variables are unset", () => {
            assert.equal(isTelegramConfigured(), false)
        })

        it("returns true for isTelegramConfigured when bot token and chat ID are present", () => {
            process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF"
            process.env.TELEGRAM_CHAT_ID = "987654321"
            assert.equal(isTelegramConfigured(), true)
        })

        it("returns false for isWhatsAppConfigured when variables are unset", () => {
            assert.equal(isWhatsAppConfigured(), false)
        })

        it("returns true for isWhatsAppConfigured with Twilio credentials", () => {
            process.env.TWILIO_ACCOUNT_SID = "AC123"
            process.env.TWILIO_AUTH_TOKEN = "secret123"
            process.env.TWILIO_WHATSAPP_NUMBER = "whatsapp:+14155238886"
            process.env.WHATSAPP_TO_NUMBER = "whatsapp:+1234567890"
            assert.equal(isWhatsAppConfigured(), true)
        })

        it("returns true for isWhatsAppConfigured with CallMeBot credentials", () => {
            process.env.CALLMEBOT_PHONE = "+1234567890"
            process.env.CALLMEBOT_API_KEY = "998877"
            assert.equal(isWhatsAppConfigured(), true)
        })
    })

    describe("3. Telegram Sender Delivery", () => {
        it("returns error without crashing when Telegram is not configured", async () => {
            const result = await sendTelegramMessage({
                text: "Test notification",
            })

            assert.equal(result.sent, false)
            assert.ok(result.error?.includes("TELEGRAM_NOT_CONFIGURED"))
        })

        it("sends message to Telegram API with HTML parse mode and link preview disabled", async () => {
            process.env.TELEGRAM_BOT_TOKEN = "mock_bot_token"
            process.env.TELEGRAM_CHAT_ID = "123456"

            let capturedUrl = ""
            let capturedBody: any = null

            const originalFetch = globalThis.fetch
            globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
                capturedUrl = String(input)
                capturedBody = JSON.parse(String(init?.body))
                return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            }) as typeof fetch

            try {
                const result = await sendTelegramMessage({
                    text: "<b>Hello World</b>",
                })

                assert.equal(result.sent, true)
                assert.equal(result.messageId, "42")
                assert.ok(capturedUrl.includes("mock_bot_token/sendMessage"))
                assert.equal(capturedBody.chat_id, "123456")
                assert.equal(capturedBody.parse_mode, "HTML")
                assert.equal(capturedBody.link_preview_options?.is_disabled, true)
            } finally {
                globalThis.fetch = originalFetch
            }
        })
    })

    describe("4. WhatsApp Sender Delivery", () => {
        it("returns error without crashing when WhatsApp is not configured", async () => {
            const result = await sendWhatsAppMessage({
                text: "Test WhatsApp notification",
            })

            assert.equal(result.sent, false)
            assert.ok(result.error?.includes("WHATSAPP_NOT_CONFIGURED"))
        })

        it("sends WhatsApp message via Twilio with Basic Auth and whatsapp: prefix formatting", async () => {
            process.env.TWILIO_ACCOUNT_SID = "AC_TEST"
            process.env.TWILIO_AUTH_TOKEN = "AUTH_TEST"
            process.env.TWILIO_WHATSAPP_NUMBER = "+14155238886"
            process.env.WHATSAPP_TO_NUMBER = "+19876543210"

            let capturedUrl = ""
            let capturedAuth = ""
            let capturedBody = ""

            const originalFetch = globalThis.fetch
            globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
                capturedUrl = String(input)
                capturedAuth = String((init?.headers as any)?.Authorization)
                capturedBody = String(init?.body)
                return new Response(JSON.stringify({ sid: "SM_MOCK_123" }), {
                    status: 201,
                    headers: { "Content-Type": "application/json" },
                })
            }) as typeof fetch

            try {
                const result = await sendWhatsAppMessage({
                    text: "*Hello from Navix*",
                })

                assert.equal(result.sent, true)
                assert.equal(result.messageId, "SM_MOCK_123")
                assert.ok(capturedUrl.includes("AC_TEST/Messages.json"))
                assert.ok(capturedAuth.startsWith("Basic "))
                assert.ok(capturedBody.includes("From=whatsapp%3A%2B14155238886"))
                assert.ok(capturedBody.includes("To=whatsapp%3A%2B19876543210"))
            } finally {
                globalThis.fetch = originalFetch
            }
        })

        it("sends WhatsApp message via CallMeBot webhook", async () => {
            process.env.CALLMEBOT_PHONE = "+19876543210"
            process.env.CALLMEBOT_API_KEY = "API_KEY_MOCK"

            let capturedUrl = ""

            const originalFetch = globalThis.fetch
            globalThis.fetch = (async (input: RequestInfo | URL) => {
                capturedUrl = String(input)
                return new Response("Message queued", { status: 200 })
            }) as typeof fetch

            try {
                const result = await sendWhatsAppMessage({
                    text: "Quick test via CallMeBot",
                })

                assert.equal(result.sent, true)
                assert.ok(capturedUrl.includes("api.callmebot.com/whatsapp.php"))
                assert.ok(capturedUrl.includes("phone=19876543210"))
                assert.ok(capturedUrl.includes("apikey=API_KEY_MOCK"))
            } finally {
                globalThis.fetch = originalFetch
            }
        })
    })

    describe("5. End-of-Workflow Automatic Dispatcher", () => {
        it("gracefully succeeds with empty dispatch when neither channel is configured", async () => {
            const dispatch = await dispatchWorkflowNotification({
                workflowName: "Test Run",
                workflowId: "wf_1",
                runId: "run_1",
                durationMs: 1000,
                steps: [],
                outputs: {},
            })

            assert.equal(dispatch.sentTelegram, false)
            assert.equal(dispatch.sentWhatsApp, false)
        })

        it("dispatches to both Telegram and WhatsApp simultaneously when both are configured", async () => {
            process.env.TELEGRAM_BOT_TOKEN = "tg_token"
            process.env.TELEGRAM_CHAT_ID = "tg_chat"
            process.env.CALLMEBOT_PHONE = "+1234567890"
            process.env.CALLMEBOT_API_KEY = "cb_key"

            const dispatchedUrls: string[] = []

            const originalFetch = globalThis.fetch
            globalThis.fetch = (async (input: RequestInfo | URL) => {
                dispatchedUrls.push(String(input))
                return new Response(JSON.stringify({ ok: true, result: { message_id: 100 } }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            }) as typeof fetch

            try {
                const dispatch = await dispatchWorkflowNotification({
                    workflowName: "Multi-channel Run",
                    workflowId: "wf_multi",
                    runId: "run_multi",
                    durationMs: 5000,
                    steps: [],
                    outputs: {},
                })

                assert.equal(dispatch.sentTelegram, true)
                assert.equal(dispatch.sentWhatsApp, true)
                assert.ok(dispatchedUrls.some((u) => u.includes("telegram.org")))
                assert.ok(dispatchedUrls.some((u) => u.includes("callmebot.com")))
            } finally {
                globalThis.fetch = originalFetch
            }
        })
    })

    describe("6. Canvas Workflow Nodes (Telegram & WhatsApp)", () => {
        it("telegramNode executes successfully with custom interpolated message", async () => {
            process.env.TELEGRAM_BOT_TOKEN = "tg_token"
            process.env.TELEGRAM_CHAT_ID = "tg_chat"

            const originalFetch = globalThis.fetch
            globalThis.fetch = (async () => {
                return new Response(JSON.stringify({ ok: true, result: { message_id: 55 } }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            }) as typeof fetch

            try {
                const output: any = await telegramNode({
                    values: {
                        message: "Hello from Telegram node! Applied to 1 job.",
                    },
                    nodeId: "telegram_1",
                })

                assert.equal(output.success, true)
                assert.equal(output.messageId, "55")
            } finally {
                globalThis.fetch = originalFetch
            }
        })

        it("whatsappNode executes successfully with auto-generated workflow summary when message is empty", async () => {
            process.env.CALLMEBOT_PHONE = "+1234567890"
            process.env.CALLMEBOT_API_KEY = "cb_key"

            let capturedText = ""
            const originalFetch = globalThis.fetch
            globalThis.fetch = (async (input: RequestInfo | URL) => {
                capturedText = decodeURIComponent(String(input))
                return new Response("OK", { status: 200 })
            }) as typeof fetch

            try {
                const output: any = await whatsappNode({
                    values: {},
                    nodeId: "whatsapp_1",
                    steps: [
                        { id: "s1", nodeId: "n1", nodeType: "agent", title: "Apply Step", status: "done", durationMs: 2000 },
                    ],
                })

                assert.equal(output.success, true)
                assert.ok(capturedText.includes("NAVIX WORKFLOW REPORT"))
                assert.ok(capturedText.includes("Apply Step"))
            } finally {
                globalThis.fetch = originalFetch
            }
        })
    })
})
