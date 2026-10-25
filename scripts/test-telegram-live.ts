import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })
dotenv.config({ path: ".env" })

import { dispatchWorkflowNotification } from "../lib/notifications/index.ts"

async function runLiveTelegramCheck() {
    console.log("========================================")
    console.log("  Telegram Workflow Notification Live Test")
    console.log("========================================\n")

    const result = await dispatchWorkflowNotification({
        workflowName: "Software Engineer Automated Application",
        workflowId: "wf_live_demo",
        runId: `run_${Date.now().toString(36)}`,
        durationMs: 42300,
        steps: [
            {
                id: "s1",
                nodeId: "open-url_1",
                nodeType: "open-url",
                title: "Open Job Board",
                status: "done",
                durationMs: 1800,
            },
            {
                id: "s2",
                nodeId: "observe_1",
                nodeType: "observe",
                title: "Observe Listings",
                status: "done",
                durationMs: 950,
            },
            {
                id: "s3",
                nodeId: "agent_1",
                nodeType: "agent",
                title: "Tailor & Submit Application",
                status: "done",
                durationMs: 36200,
            },
            {
                id: "s4",
                nodeId: "verify_1",
                nodeType: "verify",
                title: "Verify Submission Proof",
                status: "done",
                durationMs: 3350,
            },
        ],
        outputs: {
            agent_1: {
                confirmedJobs: [
                    {
                        company: "Stripe",
                        role: "Full Stack Engineer",
                        evidence: "Application submitted! Confirmation #STR-98231",
                    },
                ],
                skippedJobs: [
                    {
                        company: "Meta",
                        role: "Staff Infrastructure Engineer",
                        reason: "Requires 10+ years backend systems experience",
                    },
                ],
            },
        },
        goalEvaluation: {
            achieved: true,
            status: "achieved",
            summary: "Successfully submitted verified application with customized candidate profile.",
            evidence: "Confirmation modal detected on page with verified submission ID.",
        },
        airtableSyncResult: {
            synced: true,
            statusAssigned: "Applied",
            count: 1,
        },
    })

    if (result.sentTelegram) {
        console.log("🎉 SUCCESS: Sample workflow report sent to Telegram!")
    } else {
        console.error("❌ FAILED to send to Telegram:", result.errors.telegram)
    }
}

runLiveTelegramCheck().catch(console.error)
