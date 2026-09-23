import type { Stagehand } from "@browserbasehq/stagehand"
import { z } from "zod"

const MAX_STEPS = 20

const PlannerDecisionSchema = z.object({
    action: z.enum(["act", "done"]),
    instruction: z.string().optional(),
    message: z.string().optional(),
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

If the task is already fully complete, set action to "done" and summarize
what was accomplished in "message".
Otherwise set action to "act" and put one concrete, specific natural-language
browser instruction in "instruction" (e.g. "click the login button", "type
'admin' into the username field").`,
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