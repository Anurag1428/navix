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

const DEFAULT_CANDIDATE_PROFILE = `
Full-Stack / Frontend Developer specializing in React, TypeScript, Next.js, and modern web application development.
Passionate about creating clean, accessible, and high-performance user experiences.
Motivated, proactive learner, and ready to contribute immediately to engineering and product goals.
`.trim()

/**
 * Waits for the page content to stop mutating, and ensures any open
 * modal/drawer has rendered meaningful content (not just an empty skeleton).
 */
async function waitForPageSettle(
    page: any,
    options: {
        settleMs?: number
        maxWaitMs?: number
        minDialogTextLength?: number
    } = {}
) {
    if (!page) return
    const {
        settleMs = 400,
        maxWaitMs = 2500,
        minDialogTextLength = 100,
    } = options

    const start = Date.now()

    // 1. Initial grace period to allow click events to dispatch and initiate React/DOM updates
    await new Promise((r) => setTimeout(r, 250))

    // 2. Content-stability poll: wait until textContent length stops changing
    let lastLength = -1
    let stableSince = Date.now()

    while (Date.now() - start < maxWaitMs) {
        try {
            // Check if page has an active dialog skeleton or if content is changing
            const state = await page.evaluate(
                ({ minLength }: { minLength: number }) => {
                    // If a dialog or drawer is open, check whether it has actual content
                    const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]')
                    if (dialog) {
                        const dialogText = dialog.textContent?.trim() || ""
                        if (dialogText.length < minLength) {
                            return { isReady: false, reason: "dialog_skeleton" }
                        }
                    }

                    return {
                        isReady: true,
                        length: document.body?.textContent?.length ?? 0,
                    }
                },
                { minLength: minDialogTextLength }
            )

            if (!state.isReady) {
                // Dialog is still an empty shell/skeleton, reset stability timer
                stableSince = Date.now()
            } else if (state.length === lastLength && state.length > 0) {
                if (Date.now() - stableSince >= settleMs) {
                    return // Truly stable with real rendered content!
                }
            } else {
                lastLength = state.length
                stableSince = Date.now()
            }
        } catch {
            return
        }

        await new Promise((r) => setTimeout(r, 100))
    }
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
    candidateProfile,
}: {
    stagehand: Stagehand
    instruction: string
    candidateProfile?: string
}) {
    if (!instruction) {
        throw new Error("Agent: instruction is empty.")
    }

    const history: HistoryEntry[] = []

    for (let step = 0; step < MAX_STEPS; step++) {
        // Wait for page DOM/content to settle or key landmark elements to appear
        const page = await stagehand.browser.context.activePage()
        if (page) {
            await waitForPageSettle(page)
        }

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

RULES FOR DECISIONS:

1. SECURITY & GATES (Human-in-the-loop):
   - Strictly reserved for unsolvable security gates: CAPTCHAs, Cloudflare Turnstiles/challenges, 2FA/OTP SMS or email verification codes, or credential login prompts.
   - In those cases only, set action to "needs_human" and explain what is blocking you in "reason".
   - NEVER use "needs_human" for search criteria mismatches, unmatching listings, or missing data. Handle those autonomously.

2. THE SKELETON GUARD (Prevent Premature Backtracking):
   - If a modal, drawer, or dialog is open but contains NO job description, NO text, or only a close button ('✕'), it is in a loading/skeleton state.
   - NEVER click the close button on an empty drawer — wait or inspect the listing rather than backtracking.

3. TWO-STAGE APPLICATION FLOW & PROGRESS TRACKING:
   - The user requested applying to jobs (e.g. 5 fresher jobs). Keep track of your progress count in your step message or reasoning (e.g., "Applied: 0/5", "Applied: 1/5").
   - Phase A (Inspect): Click the job card or "Learn more" to open the details drawer.
   - Phase B (Apply): If the listing matches criteria (fresher, intern, entry-level) and an "Apply" or "Quick Apply" button is visible:
     -> Do NOT close the drawer.
     -> Click the "Apply" or "Quick Apply" button.
   - Phase C (Form): If an application question box appears (e.g. "What interests you about working for this company?"), do NOT write a generic filler sentence. Instead:
     - Read the company name, what they do, and the specific role/requirements already visible on this page.
     - Compose a genuine 2-3 sentence answer connecting the candidate's actual background (see CANDIDATE PROFILE below) to this specific company and role — reference something concrete from the page (their product, stage, the tech stack listed), not a generic statement that could apply to any company.
     - Type the answer, click the final submit "Apply", and increment your applied counter (e.g. "Applied: 1/5").
     - Record the exact text you wrote in the step history and message, so it is visible in the run's final summary for later review.

4. BACKTRACKING (Real Disqualifiers Only):
   - ONLY backtrack (click close button '✕', 'Back', or 'Close') if:
     a. The job description has fully loaded AND explicitly disqualifies the candidate (e.g. requires 3+, 5+, or 7+ years of experience when the user asked for fresher/entry-level), OR
     b. You have already submitted the application and need to return to the search list for the next job.
   - Return to the results list and proceed to the NEXT unchecked job listing.
   - Use "Steps taken so far" to avoid re-opening items you already inspected.

5. COMPLETION & EXHAUSTION:
   - If you have successfully applied to the requested number of jobs (e.g. 5/5), set action to "done" and summarize all applied jobs and companies in "message".
   - If you have inspected all visible listings on the page and no more matching jobs exist, set action to "done" with a clear explanation of how many were applied for and why no more were found.

6. ACTION FORMAT:
   - Otherwise set action to "act" and provide one concrete, unambiguous natural-language browser instruction in "instruction" (e.g., "click the 'Learn more' button on the 'Web Development Intern' card", "type 'I am excited about...' into the 'What interests you' field", "click the submit 'Apply' button").

CANDIDATE PROFILE:
${candidateProfile || DEFAULT_CANDIDATE_PROFILE}`,
            PlannerDecisionSchema
        )

        const decision = plannerResult.data

        if (decision.action === "done") {
            const page = await stagehand.browser.context.activePage()
            const resolvedUrl = page ? await page.url() : ""

            // Perform an objective verification check on the page to confirm goal completion
            let verification = {
                achieved: true,
                evidence: "Task declared completed by agent planner.",
                summary: decision.message ?? "Agent task completed.",
            }

            try {
                const verifyResult = await stagehand.extract(
                    `You are an objective auditor evaluating whether the user's task was successfully accomplished on this web page.
Goal / Task: "${instruction}"
Actions taken:
${historyText}
Agent claim: "${decision.message ?? "Completed"}"

Inspect the visible page text, confirmation modals, banners, URL, or updated state.
Did the agent genuinely achieve the user's intended goal? Provide concrete proof/evidence from the page (or explain what is missing).`,
                    z.object({
                        achieved: z.boolean().describe("Whether the goal was genuinely achieved on the page"),
                        evidence: z.string().describe("Specific proof from the page (e.g. confirmation message, order ID, success banner) or explanation of deficiency"),
                        summary: z.string().describe("Concise summary of the outcome"),
                    })
                )
                if (verifyResult?.data) {
                    verification = verifyResult.data
                }
            } catch (vErr) {
                logger.warn("[Agent] Verification extraction warning, falling back to planner decision", {
                    error: String(vErr),
                })
            }

            // If verification check indicates the goal was NOT yet achieved, and we still have steps:
            if (!verification.achieved && step < MAX_STEPS - 1) {
                logger.warn("[Agent] Completion claim rejected by verification check", {
                    reason: verification.evidence,
                    step: step + 1,
                })
                history.push({
                    instruction: "Verification checkpoint",
                    success: false,
                    message: `Verification check failed: ${verification.evidence}. Continuing execution to fulfill goal.`,
                })
                continue
            }

            // If verification indicates failure and cannot continue:
            if (!verification.achieved) {
                throw new Error(
                    `Agent goal unfulfilled: ${verification.evidence || decision.message || "Goal verification failed"}`
                )
            }

            return {
                success: true,
                achieved: true,
                completed: true,
                message: decision.message ?? "Agent task completed",
                summary: verification.summary,
                evidence: verification.evidence,
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

    throw new Error(
        `Agent did not complete the task within ${MAX_STEPS} steps. Last state URL: ${resolvedUrl || "unknown"}`
    )
}