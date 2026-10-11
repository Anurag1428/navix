import type { Stagehand } from "@browserbasehq/stagehand"
import { z } from "zod"
import { logger, metadata, wait } from "@trigger.dev/sdk"

const MAX_STEPS = 20

const PlannerDecisionSchema = z.object({
    action: z.enum(["act", "done", "needs_human"]),
    instruction: z.string().optional(),
    message: z.string().optional(),
    reason: z.string().optional(),
})

type HistoryEntry = {
    instruction: string
    success: boolean
    message: string
}

/**
 * Runs an autonomous multi-step browser task by looping:
 * plan the next single action (via extract(), routed through
 * Browserbase's model gateway) -> execute it with act() -> repeat
 * until the planner reports "done" or MAX_STEPS is hit.
 *
 * If the planner detects a CAPTCHA, Cloudflare verification, 2FA prompt,
 * or security challenge, it pauses via Trigger.dev waitpoint tokens so a human
 * can solve it in the browser and resume without burning compute.
 *
 * Replaces Stagehand v3's agent(), which does not exist in v4.
 */
export async function agentNode({
    stagehand,
    instruction,
}: {
    stagehand: Stagehand
    instruction: string
}) {
    if (!instruction) {
        throw new Error("Agent: instruction is empty.")
    }

    const history: HistoryEntry[] = []

    for (let step = 0; step < MAX_STEPS; step++) {
        const historyText = history.length
            ? history
                  .map(
                      (h, i) =>
                          `${i + 1}. ${h.instruction} -> ${
                              h.success ? "succeeded" : "FAILED"
                          }: ${h.message}`
                  )
                  .join("\n")
            : "(no steps taken yet)"

        const plannerResult = await stagehand.extract(
            `You are driving a web browser step by step to complete this task:
"${instruction}"

Steps taken so far:
${historyText}

Look at the current page and decide the SINGLE next browser action needed
to make progress on the task. If a previous step failed, try a different
approach rather than repeating it verbatim.

- If you encounter a CAPTCHA, Cloudflare Turnstile/challenge, 2FA or OTP verification code prompt, or any roadblock requiring human confirmation, set action to "needs_human" and explain what is blocking you in "reason". Do NOT attempt to guess or click through a captcha yourself.
- If the task is already fully complete, set action to "done" and summarize what was accomplished in "message".
- Otherwise set action to "act" and put one concrete, specific natural-language browser instruction in "instruction" (e.g. "click the login button", "type 'admin' into the username field").`,
            PlannerDecisionSchema
        )

        const decision = plannerResult.data

        if (decision.action === "done") {
            const page = await stagehand.browser.context.activePage()
            const resolvedUrl = page ? await page.url() : ""

            return {
                success: true,
                message: decision.message ?? "Agent task completed",
                completed: true,
                url: resolvedUrl,
                steps: history.length,
            }
        }

        if (decision.action === "needs_human") {
            const page = await stagehand.browser.context.activePage()
            const resolvedUrl = page ? await page.url() : ""
            const reason =
                decision.reason ||
                decision.message ||
                "Human interaction required (CAPTCHA, 2FA, or verification prompt detected)"

            logger.warn(`[Agent] Pausing for human intervention`, {
                reason,
                url: resolvedUrl,
                step: step + 1,
            })

            // Create a waitpoint token in Trigger.dev
            const token = await wait.createToken({
                timeout: "30m",
                tags: ["human-in-the-loop"],
            })

            // Surface to run metadata so the UI immediately renders the resume banner
            metadata.set("humanActionNeeded", {
                tokenId: token.id,
                reason,
                url: resolvedUrl,
                step: step + 1,
            })
            await metadata.flush()

            // Pause the execution without burning compute until the human solves it
            const waitResult = await wait.forToken(token)

            // Clear the alert from run metadata
            metadata.del("humanActionNeeded")
            await metadata.flush()

            history.push({
                instruction: `Human manual action: ${reason}`,
                success: waitResult.ok,
                message: waitResult.ok
                    ? "Human resolved challenge in browser"
                    : "Human action timed out",
            })

            if (!waitResult.ok) {
                throw new Error(
                    `Human intervention timed out or was canceled: ${
                        waitResult.error?.message || "Waitpoint timeout"
                    }`
                )
            }

            // Human completed the action, continue loop with the next step
            continue
        }

        if (!decision.instruction) {
            throw new Error(
                'Agent: planner returned action "act" with no instruction.'
            )
        }

        const actResult = await stagehand.act(decision.instruction)

        history.push({
            instruction: decision.instruction,
            success: actResult.data.success,
            message: actResult.data.message ?? "",
        })
    }

    const page = await stagehand.browser.context.activePage()
    const resolvedUrl = page ? await page.url() : ""

    return {
        success: false,
        message: `Agent did not complete the task within ${MAX_STEPS} steps.`,
        completed: false,
        url: resolvedUrl,
        steps: history.length,
    }
}