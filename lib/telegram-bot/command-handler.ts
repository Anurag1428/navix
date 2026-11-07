import type { ParsedCommand } from "./types"
import { replyTelegram } from "./reply"
import {
    listWorkflowsForOrg,
    findWorkflowByName,
    triggerWorkflowRun,
} from "./workflow-runner"

// ─── Help text ────────────────────────────────────────────────────────────────

const HELP_TEXT = `🤖 <b>Navix Bot Commands</b>

/run <i>workflow name</i> — Run a workflow by name
/list — List all your saved workflows
/help — Show this message

<i>Examples:</i>
• <code>/run Apply to Jobs</code>
• <code>/run wellfound</code>
• <code>/list</code>`

// ─── Command handlers ─────────────────────────────────────────────────────────

export async function handleBotCommand(
    parsed: ParsedCommand,
    orgId: string
): Promise<void> {
    const { command, args, chatId } = parsed

    switch (command) {
        case "start":
        case "help":
            await replyTelegram(chatId, HELP_TEXT)
            break

        case "list":
            await handleList(chatId, orgId)
            break

        case "run":
            await handleRun(chatId, orgId, args)
            break

        default:
            await replyTelegram(
                chatId,
                `❓ Unknown command <code>/${command}</code>. Send /help to see available commands.`
            )
    }
}

// ─── /list ────────────────────────────────────────────────────────────────────

async function handleList(chatId: number, orgId: string): Promise<void> {
    const list = await listWorkflowsForOrg(orgId)

    if (list.length === 0) {
        await replyTelegram(chatId, "📭 You have no saved workflows yet. Create one at your Navix dashboard.")
        return
    }

    const lines = list.map((w, i) => `${i + 1}. <code>${escapeHtml(w.name)}</code>`).join("\n")
    await replyTelegram(
        chatId,
        `📋 <b>Your Workflows (${list.length})</b>\n\n${lines}\n\n<i>Run one with:</i> /run &lt;name&gt;`
    )
}

// ─── /run ─────────────────────────────────────────────────────────────────────

async function handleRun(chatId: number, orgId: string, args: string[]): Promise<void> {
    if (args.length === 0) {
        await replyTelegram(
            chatId,
            "⚠️ Please provide a workflow name.\n\nUsage: <code>/run Your Workflow Name</code>\n\nSend /list to see all workflows."
        )
        return
    }

    const query = args.join(" ").trim()

    // Send an immediate "starting" acknowledgment
    await replyTelegram(
        chatId,
        `🔍 Looking for workflow matching <b>"${escapeHtml(query)}"</b>…`
    )

    const workflow = await findWorkflowByName(orgId, query)

    if (!workflow) {
        const list = await listWorkflowsForOrg(orgId)
        const suggestions =
            list.length > 0
                ? `\n\n📋 Your workflows:\n${list.map((w) => `• <code>${escapeHtml(w.name)}</code>`).join("\n")}`
                : ""

        await replyTelegram(
            chatId,
            `❌ No workflow found matching <b>"${escapeHtml(query)}"</b>.${suggestions}\n\nTry <code>/list</code> to see all workflows.`
        )
        return
    }

    // Confirm we found it and are triggering
    await replyTelegram(
        chatId,
        `🚀 <b>Starting:</b> ${escapeHtml(workflow.name)}\n\n⏳ Running in the background… You'll get a full report when it finishes.`
    )

    try {
        await triggerWorkflowRun(workflow.id, orgId)
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await replyTelegram(
            chatId,
            `💥 <b>Failed to start workflow.</b>\n\n<code>${escapeHtml(msg)}</code>`
        )
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}
