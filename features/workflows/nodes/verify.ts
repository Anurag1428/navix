import type { Page, Stagehand } from "@browserbasehq/stagehand"
import { z } from "zod"
import type { StepNodeType } from "@/features/workflows/nodes/node-registry"
import type { RunStep } from "@/features/workflows/tasks/run-workflow"
import { prunePageDom } from "./agent.ts"

export type VerificationOutcomeStatus =
    | "achieved"
    | "not_achieved"
    | "unverified"
    | "blocked"

export type VerifyNodeParams = {
    stagehand?: Stagehand
    criterion?: string
    expectedText?: string
    mode?: "auto" | "custom"
    upstreamTask?: string
    upstreamOutputs?: Record<string, unknown>
    workflowContext?: {
        nodes?: StepNodeType[]
        edges?: { source: string; target: string }[]
        outputs?: Record<string, unknown>
        steps?: RunStep[]
        nodeId?: string
    }
    throwOnFailure?: boolean
}

export type VerifyNodeResult = {
    success: boolean
    achieved: boolean
    status: VerificationOutcomeStatus
    mode: "auto" | "custom"
    criterion: string
    evidence: string
    summary: string
    url?: string
}

const VerificationAuditorSchema = z.object({
    status: z
        .enum(["achieved", "not_achieved", "unverified", "blocked"])
        .describe(
            "achieved = verified with clear proof; not_achieved = confirmed failed or error; unverified = insufficient or ambiguous evidence on page; blocked = blocked by captcha/login"
        ),
    evidence: z
        .string()
        .describe(
            "Specific proof from the page (quotes, confirmation ID, error text) or description of missing evidence"
        ),
    summary: z
        .string()
        .describe("Plain-English explanation of the evaluation outcome"),
})

/**
 * Infers the primary goal and task instructions from upstream workflow context.
 */
export function inferUpstreamGoal(params: {
    upstreamTask?: string
    workflowContext?: VerifyNodeParams["workflowContext"]
}): { goal: string; source: string; upstreamSummary?: string } | null {
    if (params.upstreamTask?.trim()) {
        return {
            goal: params.upstreamTask.trim(),
            source: "direct_param",
        }
    }

    const ctx = params.workflowContext
    if (!ctx || !ctx.nodes || ctx.nodes.length === 0) {
        return null
    }

    const { nodes, edges, outputs, nodeId } = ctx

    // 1. Trace backwards through edges connected to this verify node
    if (nodeId && edges && edges.length > 0) {
        const incomingSourceIds = edges
            .filter((e) => e.target === nodeId)
            .map((e) => e.source)

        for (const sourceId of incomingSourceIds) {
            const sourceNode = nodes.find((n) => n.id === sourceId)
            if (!sourceNode) continue

            const instruction = (sourceNode.data?.values as Record<string, string> | undefined)?.instruction
            if (instruction?.trim()) {
                const nodeOutput = outputs?.[sourceId] as Record<string, unknown> | undefined
                const upstreamSummary =
                    (typeof nodeOutput?.summary === "string" && nodeOutput.summary) ||
                    (typeof nodeOutput?.message === "string" && nodeOutput.message) ||
                    (typeof nodeOutput?.evidence === "string" && nodeOutput.evidence) ||
                    undefined

                return {
                    goal: instruction.trim(),
                    source: `connected_node_${sourceNode.data?.type || sourceId}`,
                    upstreamSummary,
                }
            }
        }
    }

    // 2. Scan backwards through all nodes for the most recent Agent node
    const agentNodes = nodes.filter((n) => n.data?.type === "agent")
    if (agentNodes.length > 0) {
        // Pick the last agent node before or in the workflow
        const agentNode = agentNodes[agentNodes.length - 1]
        const instruction = (agentNode.data?.values as Record<string, string> | undefined)?.instruction
        if (instruction?.trim()) {
            const nodeOutput = outputs?.[agentNode.id] as Record<string, unknown> | undefined
            const upstreamSummary =
                (typeof nodeOutput?.summary === "string" && nodeOutput.summary) ||
                (typeof nodeOutput?.message === "string" && nodeOutput.message) ||
                (typeof nodeOutput?.evidence === "string" && nodeOutput.evidence) ||
                undefined

            return {
                goal: instruction.trim(),
                source: "upstream_agent",
                upstreamSummary,
            }
        }
    }

    // 3. Fallback: Check for any action node with an instruction (e.g. act or extract)
    const actionWithInstruction = nodes
        .slice()
        .reverse()
        .find((n) => (n.data?.values as Record<string, string> | undefined)?.instruction?.trim())

    if (actionWithInstruction) {
        const instruction = (actionWithInstruction.data.values as Record<string, string>).instruction.trim()
        const nodeOutput = outputs?.[actionWithInstruction.id] as Record<string, unknown> | undefined
        const upstreamSummary =
            (typeof nodeOutput?.summary === "string" && nodeOutput.summary) ||
            (typeof nodeOutput?.message === "string" && nodeOutput.message) ||
            undefined

        return {
            goal: instruction,
            source: `upstream_${actionWithInstruction.data.type}`,
            upstreamSummary,
        }
    }

    return null
}

/**
 * Executes a verification check against the browser state and workflow execution results.
 * Supports Automatic Verification by default, and Custom Criterion / Expected Text as advanced mode.
 */
export async function verifyNode(params: VerifyNodeParams): Promise<VerifyNodeResult> {
    const {
        stagehand,
        criterion,
        expectedText,
        mode: requestedMode,
        upstreamTask,
        upstreamOutputs,
        workflowContext,
        throwOnFailure = false,
    } = params

    const hasCustomInput = Boolean(criterion?.trim() || expectedText?.trim())
    const effectiveMode: "auto" | "custom" =
        requestedMode === "custom" || (hasCustomInput && requestedMode !== "auto")
            ? "custom"
            : "auto"

    // ── 1. Resolve browser page state if available ──────────────────────────
    let page: Page | null = null
    let resolvedUrl = ""
    let pageTitle = ""

    if (stagehand) {
        try {
            page = (await stagehand.browser.context.activePage()) ?? null
            if (page) {
                resolvedUrl = (await page.url()) || ""
                pageTitle = (await page.title()) || ""
            }
        } catch {
            // Ignore page retrieval errors in mock/isolated environments
        }
    }

    // ── 2. Check for Security Challenge / Blocked State ──────────────────────
    if (page) {
        try {
            const isBlocked = await page.evaluate(() => {
                const text = (document.body?.innerText || "").toLowerCase()
                const title = (document.title || "").toLowerCase()
                const hasCloudflare =
                    title.includes("just a moment") ||
                    text.includes("verify you are human") ||
                    text.includes("checking your browser") ||
                    Boolean(
                        document.querySelector(
                            "iframe[src*='cloudflare'], .cf-turnstile, #challenge-running"
                        )
                    )
                const hasCaptcha =
                    text.includes("enter captcha") ||
                    Boolean(
                        document.querySelector(
                            ".g-recaptcha, .h-captcha, iframe[src*='recaptcha'], iframe[src*='hcaptcha']"
                        )
                    )
                const has2FA =
                    (text.includes("verification code") ||
                        text.includes("enter the 6-digit code")) &&
                    Boolean(
                        document.querySelector(
                            "input[name*='otp'], input[name*='code'], input[autocomplete='one-time-code']"
                        )
                    )
                return hasCloudflare || hasCaptcha || has2FA
            })

            if (isBlocked) {
                const result: VerifyNodeResult = {
                    success: false,
                    achieved: false,
                    status: "blocked",
                    mode: effectiveMode,
                    criterion: criterion?.trim() || "Security gate check",
                    evidence:
                        "Page is currently blocked by a security gate, CAPTCHA, or verification challenge.",
                    summary:
                        "Goal execution is blocked: human action or security challenge detected.",
                    url: resolvedUrl,
                }
                if (throwOnFailure) {
                    throw new Error(result.evidence)
                }
                return result
            }
        } catch (evalErr) {
            if (evalErr instanceof Error && evalErr.message.includes("Goal execution is blocked")) {
                throw evalErr
            }
        }
    }

    // ── 3. CUSTOM MODE VERIFICATION ─────────────────────────────────────────
    if (effectiveMode === "custom") {
        const customCriterion = criterion?.trim() || `Page must contain: "${expectedText?.trim()}"`

        // A. Literal text check
        if (expectedText?.trim()) {
            if (!page) {
                const result: VerifyNodeResult = {
                    success: false,
                    achieved: false,
                    status: "unverified",
                    mode: "custom",
                    criterion: customCriterion,
                    evidence: "No active browser page available to search for expected text.",
                    summary: "Unable to verify expected text: active page not accessible.",
                    url: resolvedUrl,
                }
                if (throwOnFailure) throw new Error(result.summary)
                return result
            }

            const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "")
            const containsExpected = bodyText
                .toLowerCase()
                .includes(expectedText.trim().toLowerCase())

            if (!containsExpected) {
                const result: VerifyNodeResult = {
                    success: false,
                    achieved: false,
                    status: "not_achieved",
                    mode: "custom",
                    criterion: customCriterion,
                    evidence: `Expected text "${expectedText.trim()}" was not found on the page.`,
                    summary: "Custom verification failed: expected text not found.",
                    url: resolvedUrl,
                }
                if (throwOnFailure) throw new Error(result.evidence)
                return result
            }

            // If only expectedText was provided and it passed:
            if (!criterion?.trim()) {
                return {
                    success: true,
                    achieved: true,
                    status: "achieved",
                    mode: "custom",
                    criterion: customCriterion,
                    evidence: `Expected text "${expectedText.trim()}" was confirmed present on the page.`,
                    summary: "Custom verification passed: expected text verified.",
                    url: resolvedUrl,
                }
            }
        }

        // B. Semantic Custom Criterion Evaluation
        if (stagehand) {
            try {
                let customOptions: any = undefined
                if (page) {
                    const pruneResult = await prunePageDom(page)
                    try {
                        if (pruneResult.hasOpenDialog) {
                            customOptions = {
                                locator: page.locator('[data-stagehand-active-dialog="true"]'),
                            }
                        } else {
                            customOptions = {
                                ignoreLocators: [
                                    page.locator("header"),
                                    page.locator("footer"),
                                    page.locator("nav"),
                                    page.locator('[aria-hidden="true"]'),
                                ],
                            }
                        }
                    } catch {}
                }

                const customPrompt = `You are an objective auditor verifying whether the following custom criterion has been achieved on the current page:
Criterion to verify: "${customCriterion}"
${expectedText ? `Additional expected text required: "${expectedText}"` : ""}
Current URL: ${resolvedUrl}
Current Title: ${pageTitle}

Inspect the current page text, dialogs, status alerts, form confirmations, and current state.
Determine whether the criterion is verified/satisfied:
- "achieved": The criterion is clearly satisfied with concrete proof on the page.
- "not_achieved": The criterion is clearly not met or an error message/validation failure is visible.
- "unverified": The evidence is insufficient or ambiguous to establish whether the criterion is satisfied.
- "blocked": A CAPTCHA, login gate, or security challenge blocks the page.`

                let extractResult: any = undefined
                try {
                    extractResult = await stagehand.extract(
                        customPrompt,
                        VerificationAuditorSchema,
                        customOptions
                    )
                } catch (cOptErr) {
                    if (customOptions) {
                        extractResult = await stagehand.extract(
                            customPrompt,
                            VerificationAuditorSchema
                        )
                    } else {
                        throw cOptErr
                    }
                }

                if (extractResult?.data) {
                    const status = extractResult.data.status
                    const isAchieved = status === "achieved"
                    const result: VerifyNodeResult = {
                        success: isAchieved,
                        achieved: isAchieved,
                        status,
                        mode: "custom",
                        criterion: customCriterion,
                        evidence: extractResult.data.evidence,
                        summary: extractResult.data.summary,
                        url: resolvedUrl,
                    }
                    if (throwOnFailure && !isAchieved) {
                        throw new Error(result.evidence || result.summary)
                    }
                    return result
                }
            } catch (extErr) {
                if (extErr instanceof Error && extErr.message.includes("Goal verification failed")) {
                    throw extErr
                }
            }
        }

        // Fallback if semantic check wasn't possible
        const result: VerifyNodeResult = {
            success: false,
            achieved: false,
            status: "unverified",
            mode: "custom",
            criterion: customCriterion,
            evidence: "Unable to execute semantic verification on active page.",
            summary: "Custom verification inconclusive due to extraction unavailability.",
            url: resolvedUrl,
        }
        if (throwOnFailure) throw new Error(result.summary)
        return result
    }

    // ── 4. AUTOMATIC VERIFICATION MODE (DEFAULT) ───────────────────────────
    const inferred = inferUpstreamGoal({ upstreamTask, workflowContext })

    if (!inferred) {
        const result: VerifyNodeResult = {
            success: false,
            achieved: false,
            status: "unverified",
            mode: "auto",
            criterion: "Automatic Verification (Inferred from Upstream Task)",
            evidence:
                "No upstream Agent task instruction or workflow context was found to infer verification criteria.",
            summary:
                "Unable to verify goal: missing upstream task context.",
            url: resolvedUrl,
        }
        if (throwOnFailure) throw new Error(result.summary)
        return result
    }

    const { goal, upstreamSummary } = inferred
    const combinedUpstreamContext =
        upstreamSummary ||
        (upstreamOutputs && JSON.stringify(upstreamOutputs)) ||
        "No prior execution summary recorded"

    // If no live browser page is available:
    if (!stagehand || !page) {
        const result: VerifyNodeResult = {
            success: false,
            achieved: false,
            status: "unverified",
            mode: "auto",
            criterion: goal,
            evidence:
                "No active browser page was available to inspect live DOM state and confirm task achievement.",
            summary:
                "Unable to verify goal: browser page state not accessible.",
            url: resolvedUrl,
        }
        if (throwOnFailure) throw new Error(result.summary)
        return result
    }

    // Execute semantic auditing against the inferred goal and live page state
    try {
        let auditOptions: any = undefined
        if (page) {
            const pruneResult = await prunePageDom(page)
            try {
                if (pruneResult.hasOpenDialog) {
                    auditOptions = {
                        locator: page.locator('[data-stagehand-active-dialog="true"]'),
                    }
                } else {
                    auditOptions = {
                        ignoreLocators: [
                            page.locator("header"),
                            page.locator("footer"),
                            page.locator("nav"),
                            page.locator('[aria-hidden="true"]'),
                        ],
                    }
                }
            } catch {}
        }

        const auditPrompt = `You are an objective auditor evaluating whether the user's task was successfully accomplished on this web page.
Goal / Task inferred from workflow: "${goal}"
Upstream execution results: "${combinedUpstreamContext}"
Current page URL: ${resolvedUrl}
Current page Title: ${pageTitle}

Inspect the visible page text, confirmation modals, success alerts, navigation state, or updated content.
Determine whether the goal was genuinely achieved:
- "achieved": The live page or result provides concrete, unambiguous proof (e.g. order confirmation, submitted message, created resource, requested data visible).
- "not_achieved": The live page or result shows an explicit failure, rejection, error message, or unsubmitted form with validation errors.
- "unverified": The evidence is insufficient, ambiguous, or incomplete to confirm success or failure. Do NOT assume success without real evidence.
- "blocked": The page is halted by a CAPTCHA, login gate, or security challenge.

Provide clear proof/evidence from the page and a plain-English summary.`

        let auditResult: any = undefined
        try {
            auditResult = await stagehand.extract(
                auditPrompt,
                VerificationAuditorSchema,
                auditOptions
            )
        } catch (aOptErr) {
            if (auditOptions) {
                auditResult = await stagehand.extract(
                    auditPrompt,
                    VerificationAuditorSchema
                )
            } else {
                throw aOptErr
            }
        }

        if (auditResult?.data) {
            const status = auditResult.data.status
            const isAchieved = status === "achieved"
            const result: VerifyNodeResult = {
                success: isAchieved,
                achieved: isAchieved,
                status,
                mode: "auto",
                criterion: goal,
                evidence: auditResult.data.evidence,
                summary: auditResult.data.summary,
                url: resolvedUrl,
            }
            if (throwOnFailure && !isAchieved) {
                throw new Error(result.evidence || result.summary)
            }
            return result
        }
    } catch (auditErr) {
        if (auditErr instanceof Error && auditErr.message.includes("Goal verification failed")) {
            throw auditErr
        }
    }

    // If auditing model failed or was inconclusive
    const fallbackResult: VerifyNodeResult = {
        success: false,
        achieved: false,
        status: "unverified",
        mode: "auto",
        criterion: goal,
        evidence: "Live page state could not provide conclusive evidence for automated verification.",
        summary: "Outcome unverified: insufficient evidence on the page.",
        url: resolvedUrl,
    }
    if (throwOnFailure) throw new Error(fallbackResult.summary)
    return fallbackResult
}
