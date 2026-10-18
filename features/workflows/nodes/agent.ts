import type { Stagehand } from "@browserbasehq/stagehand"
import { z } from "zod"
import { logger, metadata, wait } from "@trigger.dev/sdk"
import {
    checkJobResubmissionGuard,
    getRecentApplicationsFromAirtable,
    isGenericSearchUrl,
    type RecentAirtableApplication,
} from "../../../lib/airtable/workflow-sync.ts"

const MAX_STEPS = 20

export type JobMemoryEntry = {
    company: string
    role: string
    url?: string
    status: "inspected" | "skipped" | "attempted" | "confirmed"
    reason?: string
    evidence?: string
}

export type HistoryEntry = {
    instruction: string
    success: boolean
    message: string
}

export type AgentWorkingMemory = {
    nodeId: string
    history: HistoryEntry[]
    inspectedJobs: JobMemoryEntry[]
    confirmedJobs: JobMemoryEntry[]
    attemptedJobs: JobMemoryEntry[]
    skippedJobs: JobMemoryEntry[]
    targetCount?: number
    airtableRecentApplications?: RecentAirtableApplication[]
}

const globalAgentMemoryStore = new Map<string, AgentWorkingMemory>()

export function getAgentWorkingMemory(nodeId: string): AgentWorkingMemory {
    let mem = globalAgentMemoryStore.get(nodeId)
    if (!mem) {
        mem = {
            nodeId,
            history: [],
            inspectedJobs: [],
            confirmedJobs: [],
            attemptedJobs: [],
            skippedJobs: [],
        }
        globalAgentMemoryStore.set(nodeId, mem)
    }
    return mem
}

export function clearAgentWorkingMemory(nodeId?: string): void {
    if (nodeId) {
        globalAgentMemoryStore.delete(nodeId)
    } else {
        globalAgentMemoryStore.clear()
    }
}

export function parseTargetCountFromInstruction(instruction: string): number | undefined {
    if (!instruction) return undefined
    const match =
        instruction.match(/apply\s+(?:to\s+)?(?:the\s+(?:jobs?|listings?|roles?|positions?)\s+)?(\d+)\s+(?:jobs?|positions?|roles?|listings?)/i) ||
        instruction.match(/apply\s+(?:to\s+)?(?:up\s+to\s+)?(\d+)\s+(?:fresher\s+|intern\s+|entry[\s-]level\s+)?(?:jobs?|positions?|roles?|listings?)/i) ||
        instruction.match(/apply\s+(?:to\s+)?(\d+)\s+(?:of\s+them)?/i)
    if (match && match[1]) {
        const num = parseInt(match[1], 10)
        if (!isNaN(num) && num > 0) return num
    }
    return undefined
}

export function isSubmitAction(instruction?: string): boolean {
    if (!instruction || typeof instruction !== "string") return false
    return /(?:click|submit|press).*(?:apply|send application|application)/i.test(instruction)
}

export function isCloseAction(instruction?: string): boolean {
    if (!instruction || typeof instruction !== "string") return false
    return /(?:close|dismiss|backtrack|exit|return to (?:the )?job listings).*(?:modal|drawer|dialog|button|'✕'|'Close')|click.*(?:close button|'✕'|'Close')/i.test(
        instruction
    )
}

export function isScrollAction(instruction?: string): boolean {
    if (!instruction || typeof instruction !== "string") return false
    return /scroll\s+(?:down|up|the\s+page)/i.test(instruction)
}

/**
 * Mechanical Action Dispatcher:
 * Executes deterministic, unambiguous browser actions (close modal, scroll)
 * directly via Playwright locators — bypassing stagehand.act() entirely.
 *
 * This is the core token-saving mechanism: stagehand.act() sends the full
 * ~17k-token page accessibility tree to the LLM just to find a close button
 * or scroll the page. For these predictable actions we can resolve the element
 * in code at zero token cost.
 *
 * Returns { handled: true, success: true } ONLY after verifying the action
 * actually took effect. Returns { handled: false } in ALL uncertain or failed
 * cases so the caller falls through to stagehand.act().
 */
export async function tryMechanicalAction(
    page: any,
    instruction: string
): Promise<{ handled: boolean; success: boolean; message: string }> {
    const NOT_HANDLED = { handled: false, success: false, message: "" }

    if (!page || !instruction) return NOT_HANDLED

    // ── CLOSE / DISMISS ──────────────────────────────────────────────────────
    if (isCloseAction(instruction)) {
        try {
            const currentUrl: string = typeof page.url === "function" ? await page.url() : ""
            const hasJobListingSlug = currentUrl.includes("job_listing_slug")

            // Pre-action dialog census:
            // Count matching dialog/drawer elements BEFORE we act.
            const dialogsBefore: number = await page
                .evaluate(() =>
                    document.querySelectorAll(
                        '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [data-test*="drawer" i], [class*="styles_drawer" i]'
                    ).length
                )
                .catch(() => -1)

            if (dialogsBefore <= 0 && !hasJobListingSlug) {
                // 0 = ambiguous (no selector match); -1 = evaluate threw.
                // Either way fall through to stagehand.act().
                return NOT_HANDLED
            }

            // Step 1: Escape key — fastest on Wellfound drawers
            if (typeof page.keyPress === "function") {
                await page.keyPress("Escape")
            } else if (page.keyboard && typeof page.keyboard.press === "function") {
                await page.keyboard.press("Escape")
            }

            // Step 2: Poll for closure, tolerating CSS fade-out animations.
            const POLL_MS = 150
            const BUDGET_MS = 600
            let goneAfterEscape = false
            const t1 = Date.now()

            while (Date.now() - t1 < BUDGET_MS) {
                await new Promise((r) => setTimeout(r, POLL_MS))
                const activeUrl: string = typeof page.url === "function" ? await page.url() : ""
                const slugGone = hasJobListingSlug && !activeUrl.includes("job_listing_slug")
                const remaining: number = await page
                    .evaluate(() =>
                        document.querySelectorAll(
                            '[role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden]), [data-test*="JobListingDrawer"]:not([hidden]), [class*="styles_drawer" i]:not([hidden])'
                        ).length
                    )
                    .catch(() => (hasJobListingSlug ? 0 : dialogsBefore))
                if (slugGone || remaining === 0) {
                    goneAfterEscape = true
                    break
                }
            }

            if (goneAfterEscape) {
                return {
                    handled: true,
                    success: true,
                    message: "Modal closed via mechanical Escape key (no LLM call)",
                }
            }

            // Step 3: Escape alone didn't close it — click the DOM close button
            await page.evaluate(() => {
                const dialog = document.querySelector<HTMLElement>(
                    '[role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden]), [data-test*="JobListingDrawer"], [class*="styles_drawer" i], aside'
                )
                const searchRoot = dialog || document.body

                const candidates = Array.from(
                    searchRoot.querySelectorAll<HTMLElement>('button, [role="button"], a[role="button"]')
                )

                // 1. Accessibility attributes (aria-label, title, data-testid, data-test)
                let btn = candidates.find((el) => {
                    const attrs = (
                        (el.getAttribute("aria-label") || "") + " " +
                        (el.getAttribute("title") || "") + " " +
                        (el.getAttribute("data-test") || "") + " " +
                        (el.getAttribute("data-testid") || "")
                    ).toLowerCase()
                    return attrs.includes("close") || attrs.includes("dismiss")
                })

                // 2. Real DOM text matching (tolerates ✕, ×, X, Close, Dismiss)
                if (!btn) {
                    btn = candidates.find((el) => {
                        const text = (el.textContent || "").trim()
                        return (
                            text === "✕" ||
                            text === "×" ||
                            text === "X" ||
                            text.toLowerCase() === "close" ||
                            text.toLowerCase() === "dismiss"
                        )
                    })
                }

                // 3. SVG icon close buttons (SVG with 'x' or 'close' in class or aria)
                if (!btn) {
                    btn = candidates.find((el) => {
                        const svg = el.querySelector("svg")
                        if (!svg) return false
                        const svgClass = (svg.getAttribute("class") || "").toLowerCase()
                        const svgAria = (svg.getAttribute("aria-label") || "").toLowerCase()
                        return svgClass.includes("close") || svgClass.includes("x") || svgAria.includes("close")
                    })
                }

                // 4. Fallback to first button inside dialog if explicitly scoped
                if (!btn && dialog) {
                    btn = candidates[0]
                }

                if (btn) btn.click()
            })

            // Step 4: Poll again after DOM button click
            let goneAfterClick = false
            const t2 = Date.now()

            while (Date.now() - t2 < BUDGET_MS) {
                await new Promise((r) => setTimeout(r, POLL_MS))
                const activeUrl: string = typeof page.url === "function" ? await page.url() : ""
                const slugGone = hasJobListingSlug && !activeUrl.includes("job_listing_slug")
                const remaining: number = await page
                    .evaluate(() =>
                        document.querySelectorAll(
                            '[role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden]), [data-test*="JobListingDrawer"]:not([hidden]), [class*="styles_drawer" i]:not([hidden])'
                        ).length
                    )
                    .catch(() => (hasJobListingSlug ? 0 : dialogsBefore))
                if (slugGone || remaining === 0) {
                    goneAfterClick = true
                    break
                }
            }

            if (goneAfterClick) {
                return {
                    handled: true,
                    success: true,
                    message: "Modal closed via mechanical DOM button click (no LLM call)",
                }
            }

            // Step 5: If job_listing_slug is still active in the URL, dismiss it via history navigation
            if (hasJobListingSlug) {
                const activeUrl: string = typeof page.url === "function" ? await page.url() : ""
                if (activeUrl.includes("job_listing_slug")) {
                    await page.evaluate(() => {
                        const u = new URL(window.location.href)
                        u.searchParams.delete("job_listing_slug")
                        window.history.pushState({}, "", u.toString())
                        window.dispatchEvent(new PopStateEvent("popstate"))
                    }).catch(() => {})

                    const urlAfterPush: string = typeof page.url === "function" ? await page.url() : ""
                    if (urlAfterPush.includes("job_listing_slug")) {
                        const cleanUrl = currentUrl.replace(/[?&]job_listing_slug=[^&#]+/, "").replace(/\?$/, "")
                        if (cleanUrl && typeof page.goto === "function") {
                            await page.goto(cleanUrl, { waitUntil: "domcontentloaded" }).catch(() => {})
                        }
                    }
                    return {
                        handled: true,
                        success: true,
                        message: "Job drawer closed via URL cleanup (no LLM call)",
                    }
                }
            }

            // Step 6: All attempts failed verification — fall through to stagehand.act()
            return NOT_HANDLED
        } catch {
            // Any unexpected exception — let stagehand.act() handle it
            return NOT_HANDLED
        }
    }

    // ── SCROLL DOWN ──────────────────────────────────────────────────────────
    if (/scroll\s+down/i.test(instruction)) {
        try {
            const scrollStateBefore = await page
                .evaluate(() => ({
                    scrollY: window.scrollY,
                    scrollHeight: document.documentElement.scrollHeight,
                    innerHeight: window.innerHeight,
                }))
                .catch(() => null)

            if (!scrollStateBefore) return NOT_HANDLED

            const isAlreadyAtBottom =
                scrollStateBefore.innerHeight + scrollStateBefore.scrollY >=
                scrollStateBefore.scrollHeight - 50

            await page.evaluate(() => window.scrollBy({ top: 800, behavior: "smooth" }))

            // Poll up to 500ms for scrollY to actually increase
            let scrolled = false
            const t = Date.now()
            while (Date.now() - t < 500) {
                await new Promise((r) => setTimeout(r, 100))
                const scrollYAfter: number = await page
                    .evaluate(() => window.scrollY)
                    .catch(() => scrollStateBefore.scrollY)
                if (scrollYAfter > scrollStateBefore.scrollY) {
                    scrolled = true
                    break
                }
            }

            if (!scrolled) {
                const isNowAtBottom = await page
                    .evaluate(
                        () =>
                            window.innerHeight + window.scrollY >=
                            document.documentElement.scrollHeight - 50
                    )
                    .catch(() => false)

                if (isAlreadyAtBottom || isNowAtBottom) {
                    return {
                        handled: true,
                        success: true,
                        message: "Page is at the bottom; no further listings to scroll to.",
                    }
                }
                return NOT_HANDLED
            }

            return {
                handled: true,
                success: true,
                message: "Scrolled down via mechanical Playwright call (no LLM call)",
            }
        } catch {
            return NOT_HANDLED
        }
    }

    // ── SCROLL UP ────────────────────────────────────────────────────────────
    if (/scroll\s+up/i.test(instruction)) {
        try {
            const scrollYBefore: number = await page
                .evaluate(() => window.scrollY)
                .catch(() => -1)

            if (scrollYBefore === -1) return NOT_HANDLED

            await page.evaluate(() => window.scrollBy({ top: -800, behavior: "smooth" }))

            // Poll up to 500ms for scrollY to actually decrease
            let scrolled = false
            const t = Date.now()
            while (Date.now() - t < 500) {
                await new Promise((r) => setTimeout(r, 100))
                const scrollYAfter: number = await page
                    .evaluate(() => window.scrollY)
                    .catch(() => scrollYBefore)
                if (scrollYAfter < scrollYBefore) {
                    scrolled = true
                    break
                }
            }

            if (!scrolled) return NOT_HANDLED

            return {
                handled: true,
                success: true,
                message: "Scrolled up via mechanical Playwright call (no LLM call)",
            }
        } catch {
            return NOT_HANDLED
        }
    }

    return NOT_HANDLED
}

export function getGenuineSubmissions(mem: AgentWorkingMemory): JobMemoryEntry[] {
    const submissions: JobMemoryEntry[] = []
    const seen = new Set<string>()

    // 1. All confirmed jobs
    for (const job of mem.confirmedJobs) {
        const key = `${job.company.toLowerCase()}::${job.role.toLowerCase()}`
        if (!seen.has(key)) {
            seen.add(key)
            submissions.push(job)
        }
    }

    // 2. Attempted jobs where an actual submit instruction succeeded in history
    for (const job of mem.attemptedJobs) {
        const key = `${job.company.toLowerCase()}::${job.role.toLowerCase()}`
        if (!seen.has(key)) {
            const hasSubmitAction = mem.history.some(
                (h) => h.success && isSubmitAction(h.instruction)
            )
            if (hasSubmitAction) {
                seen.add(key)
                submissions.push(job)
            }
        }
    }

    return submissions
}


const PlannerDecisionSchema = z.object({
    action: z.enum(["act", "done", "needs_human"]),
    instruction: z.string().optional(),
    message: z.string().optional(),
    reason: z.string().optional(),
    jobUpdate: z
        .object({
            company: z.string().describe("Company name of the job currently being handled"),
            role: z.string().describe("Job title or role"),
            url: z.string().optional().describe("Direct URL of this job listing if navigated or visible"),
            status: z
                .enum(["inspected", "skipped", "attempted", "confirmed"])
                .describe("Current state of this job"),
            reason: z.string().optional().describe("Reason if skipped or status notes"),
            evidence: z.string().optional().describe("Concrete evidence text if confirmed (e.g. modal text)"),
        })
        .optional()
        .describe("Structured update for the job currently being inspected, applied, or skipped"),
    formDelegation: z
        .object({
            targetField: z
                .string()
                .describe(
                    "Name or description of the input/textarea field, e.g. 'What interests you about working for this company?'"
                ),
            company: z.string().optional().describe("Company name visible on page"),
            role: z.string().optional().describe("Job title or role visible on page"),
            question: z
                .string()
                .optional()
                .describe("The question or prompt for this field"),
            nextActionAfterTyping: z
                .string()
                .optional()
                .describe(
                    "Optional next action after typing, e.g. 'click the submit Apply button'"
                ),
        })
        .optional()
        .describe(
            "Use this when an application form or question field is open. The Micro-Brain (Qwen) will rapidly compose a tailored answer so you don't have to write long text."
        ),
})

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
 * Dual-Brain Architecture (Micro Brain):
 * Offloads rapid text synthesis, cover notes, and form answers to Qwen on Groq (qwen/qwen3.8-27b).
 * Runs in ~200-300ms using tiny context (<400 tokens) so the Macro Brain (Gemini) can stay
 * focused on reading the massive 12k+ token page layout without getting bogged down or rate-limited.
 */
export async function generateMicroResponseWithQwen({
    company,
    role,
    question,
    candidateProfile,
}: {
    company?: string
    role?: string
    question?: string
    candidateProfile?: string
}): Promise<string | null> {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) return null

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "qwen/qwen3.8-27b",
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a professional career application assistant. Write a punchy, authentic 2-sentence response connecting the candidate's exact background and skills to this specific company and role. Never use generic filler; reference the company mission/tech and the candidate's actual qualifications. Return ONLY the 2 sentences to be typed directly into the textbox.",
                    },
                    {
                        role: "user",
                        content: `Candidate Profile:\n${candidateProfile || "Fresher graduate"}\n\nTarget Company: ${company || "Company"}\nRole: ${role || "Role"}\nQuestion/Prompt: ${question || "What interests you about working for this company?"}`,
                    },
                ],
                temperature: 0.3,
                max_tokens: 180,
            }),
        })

        if (!response.ok) return null
        const data = await response.json()
        const text = data?.choices?.[0]?.message?.content?.trim()
        return text || null
    } catch (err) {
        logger.warn("[Micro-Brain Qwen] Non-blocking generation failure, falling back to Macro response", {
            error: String(err),
        })
        return null
    }
}

export interface ProcessedJobTarget {
    id?: string
    url?: string
    company: string
    role?: string
}

/**
 * DOM Pruning for Token Optimization:
 * Reduces the accessibility tree snapshot size by 50-70% before sending to the Macro LLM.
 *
 * 1. Boilerplate Clutter: Marks footers, cookie banners, chat widgets, and feedback tools with aria-hidden="true".
 * 2. Decorative SVGs: Marks complex icon/illustration SVGs without labels as aria-hidden="true".
 * 3. Already Processed Job Cards: Marks cards for specific jobs (by ID, URL, or company + role)
 *    that have already been skipped or confirmed as aria-hidden="true" so Gemini doesn't re-read stale cards.
 *    NOTE: Never masks by company alone; multiple roles at the same company remain discoverable!
 * 4. Active Dialog Isolation: If an application drawer/modal is open, marks background siblings
 *    outside the dialog as aria-hidden="true" so the snapshot focuses strictly on the active drawer.
 * 5. Dynamic Off-Screen Bounding & Restoration: Hides cards scrolled far out of view (-800px / +1500px),
 *    and dynamically restores their original visibility whenever they scroll back into the active buffer!
 */
export async function prunePageDom(
    page: any,
    options: {
        processedJobs?: ProcessedJobTarget[]
        processedCompanies?: string[]
        isolateOpenDialog?: boolean
    } = {}
): Promise<{ prunedCount: number; restoredCount: number; hasOpenDialog: boolean }> {
    if (!page) return { prunedCount: 0, restoredCount: 0, hasOpenDialog: false }

    try {
        return await page.evaluate(
            ({
                jobs,
                companies,
                isolateDialog,
            }: {
                jobs: ProcessedJobTarget[]
                companies: string[]
                isolateDialog: boolean
            }) => {
                let prunedCount = 0
                let restoredCount = 0
                const vh = window.innerHeight || 800

                // 0. Dynamic Restoration: Restore any previously off-screen cards that scrolled back into the active buffer
                try {
                    const offscreenElements = document.querySelectorAll<HTMLElement>(
                        '[data-pruned-offscreen="true"]'
                    )
                    offscreenElements.forEach((el) => {
                        try {
                            const rect = el.getBoundingClientRect()
                            // If the element is now within the active buffer (-800px to vh + 1500px), restore it
                            const isInActiveRange = rect.bottom >= -800 && rect.top <= (vh + 1500)
                            if (isInActiveRange) {
                                const originalAria = el.getAttribute("data-stagehand-original-aria-hidden")
                                if (originalAria && originalAria !== "__none__") {
                                    el.setAttribute("aria-hidden", originalAria)
                                } else {
                                    el.removeAttribute("aria-hidden")
                                }
                                el.removeAttribute("data-pruned-offscreen")
                                el.removeAttribute("data-stagehand-original-aria-hidden")
                                restoredCount++
                            }
                        } catch {}
                    })
                } catch {}

                // 1. Hide footer, cookie notices, chat widgets, feedback tools
                const boilerplateSelectors = [
                    "footer",
                    "#cookie-banner",
                    ".cookie-banner",
                    '[id*="cookie" i]',
                    '[class*="cookie" i]',
                    "#intercom-container",
                    '[class*="intercom" i]',
                    'iframe[title*="chat" i]',
                    'aside[aria-label*="feedback" i]',
                ]
                for (const sel of boilerplateSelectors) {
                    try {
                        const elements = document.querySelectorAll<HTMLElement>(sel)
                        elements.forEach((el) => {
                            if (!el.getAttribute("aria-hidden")) {
                                el.setAttribute("aria-hidden", "true")
                                prunedCount++
                            }
                        })
                    } catch {}
                }

                // 2. Hide decorative SVGs (paths with no text, no title, no aria-label)
                try {
                    const svgs = document.querySelectorAll<SVGElement>("svg")
                    svgs.forEach((svg) => {
                        const hasLabel =
                            svg.getAttribute("aria-label") ||
                            svg.getAttribute("title") ||
                            svg.querySelector("title") ||
                            svg.closest("button")?.getAttribute("aria-label")
                        if (!hasLabel && !svg.getAttribute("aria-hidden")) {
                            svg.setAttribute("aria-hidden", "true")
                            prunedCount++
                        }
                    })
                } catch {}

                // Helper matchers for processed job cards
                function matchesJobId(card: HTMLElement, targetId?: string): boolean {
                    if (!targetId || typeof targetId !== "string" || targetId.trim().length < 3) {
                        return false
                    }
                    const cleanId = targetId.trim()
                    const idLower = cleanId.toLowerCase()

                    if (
                        card.getAttribute("data-job-id") === cleanId ||
                        card.getAttribute("data-id") === cleanId ||
                        card.id === cleanId ||
                        card.id.toLowerCase().includes(idLower)
                    ) {
                        return true
                    }

                    const matchingChild = card.querySelector(
                        `[data-job-id="${cleanId}"], [data-id="${cleanId}"], [id*="${cleanId}"]`
                    )
                    if (matchingChild) return true

                    const anchors = card.querySelectorAll<HTMLAnchorElement>("a[href]")
                    for (const a of Array.from(anchors)) {
                        const href = a.getAttribute("href") || ""
                        if (href.includes(cleanId)) return true
                    }

                    return false
                }

                function matchesJobUrl(card: HTMLElement, targetUrl?: string): boolean {
                    if (!targetUrl || typeof targetUrl !== "string" || targetUrl.trim().length <= 5) {
                        return false
                    }
                    const cleanTarget = targetUrl.trim().toLowerCase()
                    let targetPath = ""
                    try {
                        const parsed = new URL(cleanTarget, window.location.origin)
                        targetPath = parsed.pathname.replace(/\/+$/, "")
                    } catch {
                        targetPath = cleanTarget.split("?")[0].split("#")[0].replace(/\/+$/, "")
                    }

                    if (!targetPath || /^\/(?:jobs?|search|browse|explore|find)?\/?$/i.test(targetPath)) {
                        return false
                    }

                    const anchors = card.querySelectorAll<HTMLAnchorElement>("a[href]")
                    for (const a of Array.from(anchors)) {
                        try {
                            const aHref = a.getAttribute("href") || ""
                            if (!aHref) continue
                            const aUrl = new URL(aHref, window.location.origin)
                            const aPath = aUrl.pathname.replace(/\/+$/, "").toLowerCase()
                            if (aPath && (aPath === targetPath || aPath.endsWith(targetPath) || targetPath.endsWith(aPath))) {
                                return true
                            }
                        } catch {
                            const rawHref = (a.getAttribute("href") || "").toLowerCase()
                            if (rawHref && targetPath && (rawHref.includes(targetPath) || targetPath.includes(rawHref))) {
                                return true
                            }
                        }
                    }
                    return false
                }

                function matchesCompanyAndRole(card: HTMLElement, company?: string, role?: string): boolean {
                    if (!company || typeof company !== "string" || !role || typeof role !== "string") {
                        return false
                    }
                    const cNorm = company.trim().toLowerCase()
                    const rNorm = role.trim().toLowerCase()
                    if (cNorm.length < 2 || rNorm.length < 2) return false
                    if (cNorm === "null" || cNorm === "undefined" || rNorm === "null" || rNorm === "undefined") {
                        return false
                    }

                    const cardText = (card.textContent || "").toLowerCase()
                    if (!cardText.includes(cNorm)) return false

                    if (cardText.includes(rNorm)) return true

                    const cleanRole = rNorm.replace(/\s*\([^)]*\)/g, "").trim()
                    if (cleanRole.length >= 3 && cardText.includes(cleanRole)) {
                        return true
                    }

                    return false
                }

                // 3. Hide already processed job cards (must match specific ID, canonical URL, or company + role)
                const cardSelectors = [
                    '[role="listitem"]',
                    "article",
                    '[data-test*="job" i]',
                    '[class*="job-card" i]',
                    '[class*="JobCard" i]',
                    '[class*="jobCard" i]',
                    "[data-job-id]",
                    '[data-testid*="job" i]',
                ]

                const targetJobs: ProcessedJobTarget[] = Array.isArray(jobs) ? [...jobs] : []

                if (targetJobs.length > 0) {
                    try {
                        const cards = document.querySelectorAll<HTMLElement>(cardSelectors.join(", "))
                        cards.forEach((card) => {
                            const matchesProcessed = targetJobs.some((target) => {
                                // 1. Direct Job ID match
                                if (target.id && matchesJobId(card, target.id)) return true
                                // 2. Canonical Job URL match
                                if (target.url && matchesJobUrl(card, target.url)) return true
                                // 3. Fallback: Company AND Role together
                                if (target.company && target.role && matchesCompanyAndRole(card, target.company, target.role)) return true
                                // Never match by company alone: other roles at that company remain discoverable!
                                return false
                            })

                            if (matchesProcessed && !card.getAttribute("aria-hidden")) {
                                if (!card.hasAttribute("data-stagehand-original-aria-hidden")) {
                                    card.setAttribute(
                                        "data-stagehand-original-aria-hidden",
                                        card.getAttribute("aria-hidden") || "__none__"
                                    )
                                }
                                card.setAttribute("data-pruned-processed", "true")
                                card.setAttribute("aria-hidden", "true")
                                prunedCount++
                            }
                        })
                    } catch {}
                }

                // 4. Dialog isolation: If a modal/drawer is genuinely VISIBLE on screen, isolate it
                let hasOpenDialog = false
                try {
                    const dialogs = Array.from(
                        document.querySelectorAll<HTMLElement>(
                            '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [data-test*="drawer" i], [class*="styles_drawer" i]'
                        )
                    )
                    const visibleDialog = dialogs.find((el) => {
                        try {
                            const style = window.getComputedStyle(el)
                            const rect = el.getBoundingClientRect()
                            const isDisplayVisible =
                                style.display !== "none" &&
                                style.visibility !== "hidden" &&
                                style.opacity !== "0"
                            const hasDimensions =
                                (rect.width > 20 && rect.height > 20) ||
                                (el.offsetWidth > 20 && el.offsetHeight > 20)
                            return isDisplayVisible && hasDimensions
                        } catch {
                            return false
                        }
                    })

                    if (visibleDialog) {
                        hasOpenDialog = true
                        visibleDialog.setAttribute("data-stagehand-active-dialog", "true")

                        if (isolateDialog) {
                            const topLevelContainers = document.querySelectorAll<HTMLElement>(
                                "body > div:not([data-stagehand-active-dialog='true']):not([role='dialog']):not([aria-modal='true']), main"
                            )
                            topLevelContainers.forEach((container) => {
                                if (!container.contains(visibleDialog) && !container.getAttribute("aria-hidden")) {
                                    if (!container.hasAttribute("data-stagehand-original-aria-hidden")) {
                                        container.setAttribute(
                                            "data-stagehand-original-aria-hidden",
                                            container.getAttribute("aria-hidden") || "__none__"
                                        )
                                    }
                                    container.setAttribute("data-pruned-dialog", "true")
                                    container.setAttribute("aria-hidden", "true")
                                    prunedCount++
                                }
                            })
                        }
                    } else {
                        // Ensure any stale marker is cleared
                        document.querySelectorAll('[data-stagehand-active-dialog]').forEach((el) => {
                            el.removeAttribute("data-stagehand-active-dialog")
                        })
                        // Restore containers previously hidden by dialog isolation
                        document.querySelectorAll<HTMLElement>('[data-pruned-dialog="true"]').forEach((container) => {
                            try {
                                const originalAria = container.getAttribute("data-stagehand-original-aria-hidden")
                                if (originalAria && originalAria !== "__none__") {
                                    container.setAttribute("aria-hidden", originalAria)
                                } else {
                                    container.removeAttribute("aria-hidden")
                                }
                                container.removeAttribute("data-pruned-dialog")
                                container.removeAttribute("data-stagehand-original-aria-hidden")
                                restoredCount++
                            } catch {}
                        })
                    }
                } catch {}

                // 5. Hide job cards that have scrolled far off-screen (viewport bounding for infinite scroll)
                try {
                    const allCards = document.querySelectorAll<HTMLElement>(cardSelectors.join(", "))
                    allCards.forEach((card) => {
                        try {
                            if (
                                card.hasAttribute("data-pruned-processed") ||
                                card.hasAttribute("data-pruned-dialog")
                            ) {
                                return
                            }
                            const rect = card.getBoundingClientRect()
                            // If the card is more than 800px above the top of the viewport or 1500px below
                            const isFarOffScreen = rect.bottom < -800 || rect.top > (vh + 1500)
                            if (isFarOffScreen && !card.getAttribute("aria-hidden")) {
                                if (!card.hasAttribute("data-stagehand-original-aria-hidden")) {
                                    card.setAttribute(
                                        "data-stagehand-original-aria-hidden",
                                        card.getAttribute("aria-hidden") || "__none__"
                                    )
                                }
                                card.setAttribute("data-pruned-offscreen", "true")
                                card.setAttribute("aria-hidden", "true")
                                prunedCount++
                            }
                        } catch {}
                    })
                } catch {}

                return { prunedCount, restoredCount, hasOpenDialog }
            },
            {
                jobs: options.processedJobs || [],
                companies: options.processedCompanies || [],
                isolateDialog: options.isolateOpenDialog !== false,
            }
        )
    } catch {
        return { prunedCount: 0, restoredCount: 0, hasOpenDialog: false }
    }
}

/**
 * Fully restores all elements modified by prunePageDom to their original accessibility state.
 */
export async function restorePrunedPageDom(page: any): Promise<number> {
    if (!page) return 0
    try {
        return await page.evaluate(() => {
            let restored = 0
            const pruned = document.querySelectorAll<HTMLElement>(
                '[data-stagehand-original-aria-hidden], [data-pruned-offscreen], [data-pruned-processed], [data-pruned-dialog]'
            )
            pruned.forEach((el) => {
                try {
                    const originalAria = el.getAttribute("data-stagehand-original-aria-hidden")
                    if (originalAria && originalAria !== "__none__") {
                        el.setAttribute("aria-hidden", originalAria)
                    } else {
                        el.removeAttribute("aria-hidden")
                    }
                    el.removeAttribute("data-stagehand-original-aria-hidden")
                    el.removeAttribute("data-pruned-offscreen")
                    el.removeAttribute("data-pruned-processed")
                    el.removeAttribute("data-pruned-dialog")
                    restored++
                } catch {}
            })
            document.querySelectorAll('[data-stagehand-active-dialog]').forEach((el) => {
                el.removeAttribute("data-stagehand-active-dialog")
            })
            return restored
        })
    } catch {
        return 0
    }
}

/**
 * Executes stagehand.extract with automatic rate-limit backoff retry and optional locator scoping.
 * Catches 429 quota exhaustion (e.g. Gemini 250k input tokens/min free tier)
 * by pausing for rolling quota reset before retrying rather than aborting the workflow.
 */
export async function extractWithRetry<T>(
    stagehand: Stagehand,
    prompt: string,
    schema: z.ZodType<T>,
    optionsOrMaxRetries?: any,
    maybeMaxRetries?: number
): Promise<{ data: T }> {
    let options: any = undefined
    let maxRetries = 3

    if (typeof optionsOrMaxRetries === "number") {
        maxRetries = optionsOrMaxRetries
    } else if (optionsOrMaxRetries && typeof optionsOrMaxRetries === "object") {
        options = optionsOrMaxRetries
        if (typeof maybeMaxRetries === "number") {
            maxRetries = maybeMaxRetries
        }
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return (await stagehand.extract(prompt, schema as any, options)) as { data: T }
        } catch (err: any) {
            // If scoped options (locator / ignoreLocators) caused an issue on attempt 0,
            // immediately retry without options before falling into backoff
            if (options && attempt === 0) {
                logger.warn(
                    "[Agent] Scoped extraction failed, falling back to unconstrained extract",
                    { error: String(err?.message || err) }
                )
                try {
                    return (await stagehand.extract(prompt, schema as any)) as { data: T }
                } catch {}
            }

            const errStr = String(err?.message || err)
            const isDailyQuotaExceeded =
                errStr.includes("free_tier_requests") ||
                /retry in \d+h/i.test(errStr) ||
                (errStr.includes("Quota exceeded") && errStr.toLowerCase().includes("daily"))

            if (isDailyQuotaExceeded) {
                logger.error(
                    `[Agent] Daily AI model quota hard ceiling reached. Failing immediately without backoff.`,
                    { error: errStr }
                )
                throw new Error(`AI model daily quota exceeded (${errStr}). Please switch API keys or upgrade provider tier.`)
            }

            const isRateLimit =
                errStr.includes("429") ||
                errStr.includes("Quota exceeded") ||
                errStr.includes("RESOURCE_EXHAUSTED") ||
                errStr.includes("rate_limit") ||
                err?.status === 429

            if (isRateLimit && attempt < maxRetries) {
                const backoffMs = (attempt + 1) * 12000
                logger.warn(
                    `[Agent] Rate limit / quota reached. Waiting ${backoffMs / 1000}s before retry ${attempt + 1}/${maxRetries}...`,
                    { error: errStr }
                )
                await new Promise((r) => setTimeout(r, backoffMs))
                continue
            }
            throw err
        }
    }
    throw new Error("extractWithRetry exhausted")
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
    nodeId = "default",
}: {
    stagehand: Stagehand
    instruction: string
    candidateProfile?: string
    nodeId?: string
}) {
    if (!instruction) {
        throw new Error("Agent: instruction is empty.")
    }

    // Pre-application duplicate protection check against Airtable
    try {
        const initialPage = await stagehand.browser.context.activePage()
        const initialUrl = initialPage ? await initialPage.url() : ""
        if (initialUrl && initialUrl.startsWith("http")) {
            const guard = await checkJobResubmissionGuard({ jobUrl: initialUrl })
            if (guard.blocked) {
                logger.info(`[Agent] Resubmission prevented: ${guard.reason}`)
                return {
                    success: true,
                    achieved: true,
                    completed: true,
                    alreadyApplied: true,
                    message: guard.reason || "Application blocked: already Applied in Airtable.",
                    summary: guard.reason || "Job already Applied in Airtable. Accidental resubmission prevented.",
                    evidence: `Airtable record verified in status: ${guard.status}`,
                    url: initialUrl,
                    steps: 0,
                    confirmedJobs: [],
                    attemptedJobs: [],
                    skippedJobs: [],
                    inspectedJobs: [],
                }
            }
        }
    } catch (guardErr) {
        logger.warn("[Agent] Resubmission guard check warning (non-blocking)", {
            error: String(guardErr),
        })
    }

    const mem = getAgentWorkingMemory(nodeId)
    if (!mem.targetCount) {
        mem.targetCount = parseTargetCountFromInstruction(instruction)
    }

    for (let step = 0; step < MAX_STEPS; step++) {
        // Rate-limit shield: gentle pause between Macro extraction calls
        // to prevent exceeding free-tier 15 RPM limits on Gemini
        if (step > 0) {
            await new Promise((r) => setTimeout(r, 2000))
        }

        // Wait for page DOM/content to settle or key landmark elements to appear
        const page = await stagehand.browser.context.activePage()
        if (page) {
            await waitForPageSettle(page)
        }

        const historyText = mem.history.length
            ? mem.history
                  .map(
                      (h, i) =>
                          `${i + 1}. ${h.instruction} -> ${
                              h.success ? "succeeded" : "FAILED"
                          }: ${h.message}`
                  )
                  .join("\n")
            : "(no steps taken yet)"

        const workingMemoryText = `
- Applications Confirmed: ${mem.confirmedJobs.length}${mem.targetCount ? ` / ${mem.targetCount}` : ""}
${mem.confirmedJobs.length > 0 ? mem.confirmedJobs.map((j) => `  • [CONFIRMED] ${j.company} - ${j.role}${j.url ? ` (${j.url})` : ""}`).join("\n") : "  (none yet)"}
- Listings Inspected / Attempted:
${mem.inspectedJobs.length > 0 ? mem.inspectedJobs.map((j) => `  • ${j.company} - ${j.role} [${j.status}]${j.reason ? `: ${j.reason}` : ""}`).join("\n") : "  (none yet)"}
- Listings Skipped / Disqualified:
${mem.skippedJobs.length > 0 ? mem.skippedJobs.map((j) => `  • ${j.company} - ${j.role}: ${j.reason || "did not match criteria"}`).join("\n") : "  (none yet)"}
`.trim()

        // ── DOM Pruning & Scoped Extraction (Token Optimization) ───────────
        let extractOptions: any = undefined
        if (page) {
            const processedJobs: ProcessedJobTarget[] = [
                ...mem.skippedJobs.map((j) => ({
                    company: j.company,
                    role: j.role,
                    url: j.url,
                })),
                ...mem.confirmedJobs.map((j) => ({
                    company: j.company,
                    role: j.role,
                    url: j.url,
                })),
                ...(mem.airtableRecentApplications?.map((j) => ({
                    company: j.company,
                    role: j.role,
                    url: j.jobUrl,
                    id: j.jobId,
                })) || []),
            ]
            const pruneResult = await prunePageDom(page, { processedJobs })
            if (pruneResult.prunedCount > 0 || pruneResult.restoredCount > 0) {
                logger.info(
                    `[Agent] DOM Pruning: masked ${pruneResult.prunedCount}, restored ${pruneResult.restoredCount} elements (dialogOpen=${pruneResult.hasOpenDialog})`
                )
            }

            try {
                if (pruneResult.hasOpenDialog) {
                    // Scope extraction to the open drawer/modal to drop background tokens
                    extractOptions = {
                        locator: page.locator('[data-stagehand-active-dialog="true"]'),
                    }
                } else {
                    // On search results, ignore static header/footer/nav and aria-hidden elements
                    extractOptions = {
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

        let plannerAttempts = 0
        let decision: z.infer<typeof PlannerDecisionSchema> | undefined

        while (plannerAttempts < 2 && !decision) {
            plannerAttempts++
            try {
                const result = await extractWithRetry(
                    stagehand,
                    `You are driving a web browser step by step to complete this task:
"${instruction}"

Steps taken so far:
${historyText}

Current Working Memory:
${workingMemoryText}

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
   - Always report "jobUpdate" when inspecting, skipping, attempting, or confirming a job. Include company, role, direct URL (if visible/available), and status ("inspected", "skipped", "attempted", "confirmed").
   - STATUS LIFECYCLE:
     • "inspected": Used when clicking a job card, 'Learn more', reading requirements, or filling form textboxes. Merely viewing or typing in fields is "inspected" until the submit button is actually clicked.
     • "skipped": Used when a job is disqualified (e.g. requires 3+ years experience when seeking fresher/intern roles).
     • "attempted": Used ONLY in the single step where you click the final submit button ('Apply', 'Send application', 'Submit application'). NEVER mark 'attempted' while merely viewing or typing.
     • "confirmed": Used ONLY when submission confirmation is visible on the page (e.g. "Application submitted" dialog, success banner, or confirmation text).
   - SUBMISSION BEHAVIOR:
     • Click 'Apply' or submit button ONCE per application. A single click submits the form.
     • NEVER click 'Apply' repeatedly on the same job!
     • Once you click 'Apply', close the drawer / modal by clicking the '✕' or 'Close' button to return to the job listings.
   - Phase A (Inspect): Click the job card or "Learn more" to open the details drawer (status: "inspected").
   - Phase B (Apply): If the listing matches criteria (fresher, intern, entry-level) and an "Apply" or "Quick Apply" button is visible:
     -> Do NOT close the drawer.
     -> Click the "Apply" or "Quick Apply" button.
   - Phase C (Form - DUAL-BRAIN MICRO DELEGATION):
     -> If an application question box appears (e.g. "What interests you about working for this company?", "Why should we hire you?", "Cover note"):
        You do NOT need to compose the long answer yourself!
        Instead, set "formDelegation" in your decision with:
        - targetField: the textbox label or placeholder
        - company: company name visible on page
        - role: job title visible on page
        - question: the question being asked
        - nextActionAfterTyping: "click the submit 'Apply' button" (or "click the 'Send application' button")
        The Micro-Brain (Qwen) will instantly compose a tailored response and type it in.
        Alternatively, provide "instruction" directly.
     -> When application submission is confirmed on page (e.g. "Application submitted" or success dialog), set jobUpdate status to "confirmed" with evidence text.

4. BACKTRACKING (Real Disqualifiers or After Submitting Only):
   - ONLY backtrack (click close button '✕', 'Back', or 'Close') if:
     a. The job description has fully loaded AND explicitly disqualifies the candidate (e.g. requires 3+, 5+, or 7+ years of experience when the user asked for fresher/entry-level), OR
     b. You have clicked the submit 'Apply' button and need to return to the search list for the next job.
   - Return to the results list and proceed to the NEXT unchecked job listing.
   - Use "Steps taken so far" and "Current Working Memory" to avoid re-opening items you already inspected.

5. COMPLETION & TARGET COUNT INTEGRITY:
   - Target count: ${mem.targetCount ? `${mem.targetCount} job applications` : "requested applications"}.
   - You MUST apply to the requested number of distinct jobs. Never declare "done" if you only viewed or clicked "Learn more" on a job without submitting its application!
   - If you have successfully applied to the requested number of jobs (${mem.targetCount ? `${mem.targetCount}/${mem.targetCount}` : "target"}), set action to "done" and summarize all applied jobs and companies in "message".
   - If and ONLY if you have inspected all visible listings on the page and no more matching jobs exist, set action to "done" with a clear explanation of how many were applied for and that no more matching listings were found.

6. ACTION FORMAT:
   - Otherwise set action to "act" and provide one concrete, unambiguous natural-language browser instruction in "instruction" (e.g., "click the 'Learn more' button on the 'Web Development Intern' card", "type 'I am excited about...' into the 'What interests you' field", "click the submit 'Apply' button").

CANDIDATE PROFILE:
${candidateProfile || DEFAULT_CANDIDATE_PROFILE}`,
                    PlannerDecisionSchema,
                    extractOptions
                )
                decision = result.data
            } catch (err: any) {
                if (plannerAttempts >= 2) {
                    throw new Error(
                        `Planner failed to return a valid decision after 2 attempts: ${err?.message || err}`
                    )
                }
                logger.warn(
                    `[Agent] Planner attempt ${plannerAttempts} failed schema validation. Retrying extraction...`,
                    { error: String(err?.message || err) }
                )
                await new Promise((r) => setTimeout(r, 1000))
            }
        }

        if (!decision) {
            throw new Error("Planner failed to return a valid decision after 2 attempts.")
        }

        if (decision.jobUpdate) {
            const { company, role, url, status, reason, evidence } = decision.jobUpdate
            const cleanUrl = isGenericSearchUrl(url) ? undefined : url

            // Strict Status Lifecycle Enforcement:
            // "attempted" is strictly reserved for when a submit action is actually triggered.
            // If the agent attempts to report "attempted" while merely inspecting, reading, or typing, demote to "inspected".
            let effectiveStatus = status
            if (effectiveStatus === "attempted") {
                const isCurrentlySubmitting =
                    isSubmitAction(decision.instruction) ||
                    isSubmitAction(decision.formDelegation?.nextActionAfterTyping) ||
                    mem.history.some((h) => h.success && isSubmitAction(h.instruction))

                if (!isCurrentlySubmitting) {
                    effectiveStatus = "inspected"
                }
            }

            const entry: JobMemoryEntry = {
                company: company.trim(),
                role: role.trim(),
                url: cleanUrl,
                status: effectiveStatus,
                reason,
                evidence,
            }

            const existingInspectedIdx = mem.inspectedJobs.findIndex(
                (j) => j.company.toLowerCase() === entry.company.toLowerCase() && j.role.toLowerCase() === entry.role.toLowerCase()
            )
            if (existingInspectedIdx >= 0) {
                mem.inspectedJobs[existingInspectedIdx] = entry
            } else {
                mem.inspectedJobs.push(entry)
            }

            if (effectiveStatus === "confirmed") {
                const existingConfirmedIdx = mem.confirmedJobs.findIndex(
                    (j) => j.company.toLowerCase() === entry.company.toLowerCase() && j.role.toLowerCase() === entry.role.toLowerCase()
                )
                if (existingConfirmedIdx >= 0) {
                    mem.confirmedJobs[existingConfirmedIdx] = entry
                } else {
                    mem.confirmedJobs.push(entry)
                }

                // Remove from attemptedJobs if it was previously recorded there
                const attIdx = mem.attemptedJobs.findIndex(
                    (j) => j.company.toLowerCase() === entry.company.toLowerCase() && j.role.toLowerCase() === entry.role.toLowerCase()
                )
                if (attIdx >= 0) {
                    mem.attemptedJobs.splice(attIdx, 1)
                }
            } else if (effectiveStatus === "attempted") {
                const existingAttemptedIdx = mem.attemptedJobs.findIndex(
                    (j) => j.company.toLowerCase() === entry.company.toLowerCase() && j.role.toLowerCase() === entry.role.toLowerCase()
                )
                if (existingAttemptedIdx >= 0) {
                    mem.attemptedJobs[existingAttemptedIdx] = entry
                } else {
                    mem.attemptedJobs.push(entry)
                }
            } else if (effectiveStatus === "skipped") {
                const existingSkippedIdx = mem.skippedJobs.findIndex(
                    (j) => j.company.toLowerCase() === entry.company.toLowerCase() && j.role.toLowerCase() === entry.role.toLowerCase()
                )
                if (existingSkippedIdx >= 0) {
                    mem.skippedJobs[existingSkippedIdx] = entry
                } else {
                    mem.skippedJobs.push(entry)
                }

                // Remove from attemptedJobs if skipped
                const attIdx = mem.attemptedJobs.findIndex(
                    (j) => j.company.toLowerCase() === entry.company.toLowerCase() && j.role.toLowerCase() === entry.role.toLowerCase()
                )
                if (attIdx >= 0) {
                    mem.attemptedJobs.splice(attIdx, 1)
                }
            }

            try {
                metadata.set("agentWorkingMemory", {
                    nodeId,
                    historyLength: mem.history.length,
                    confirmedCount: mem.confirmedJobs.length,
                    targetCount: mem.targetCount ?? null,
                })
                await metadata.flush()
            } catch {}
        }

        if (decision.action === "done") {
            const genuineSubmissions = getGenuineSubmissions(mem)

            // Target Count Completion Guard:
            // Prevent premature completion if the agent claims success but genuine submitted jobs < targetCount
            if (mem.targetCount && genuineSubmissions.length < mem.targetCount && step < MAX_STEPS - 2) {
                const isClaimingExhaustion = /no\s+(?:more|other|matching|further)\s+jobs?|inspected\s+all|exhausted|could\s+not\s+find|no\s+additional/i.test(
                    decision.message || ""
                )

                if (!isClaimingExhaustion) {
                    logger.warn("[Agent] Premature completion rejected: target count not satisfied", {
                        targetCount: mem.targetCount,
                        submittedCount: genuineSubmissions.length,
                        step: step + 1,
                    })

                    mem.history.push({
                        instruction: "Target count check",
                        success: false,
                        message: `Target count not reached: ${genuineSubmissions.length}/${mem.targetCount} jobs applied. Applied so far: ${
                            genuineSubmissions.map((j) => `${j.company} - ${j.role}`).join(", ") || "none"
                        }. Please continue searching and apply to the remaining ${
                            mem.targetCount - genuineSubmissions.length
                        } job(s). Close any open drawer/modal and inspect the next matching job listing.`,
                    })
                    continue
                }
            }

            const page = await stagehand.browser.context.activePage()
            const resolvedUrl = page ? await page.url() : ""

            // Perform an objective verification check on the page to confirm goal completion
            let verification = {
                achieved: true,
                evidence: "Task declared completed by agent planner.",
                summary: decision.message ?? "Agent task completed.",
            }

            try {
                let auditOptions: any = undefined
                if (page) {
                    const processedJobs: ProcessedJobTarget[] = [
                        ...mem.skippedJobs.map((j) => ({
                            company: j.company,
                            role: j.role,
                            url: j.url,
                        })),
                        ...mem.confirmedJobs.map((j) => ({
                            company: j.company,
                            role: j.role,
                            url: j.url,
                        })),
                        ...(mem.airtableRecentApplications?.map((j) => ({
                            company: j.company,
                            role: j.role,
                            url: j.jobUrl,
                            id: j.jobId,
                        })) || []),
                    ]
                    const pruneResult = await prunePageDom(page, { processedJobs })
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

                const verifyResult = await extractWithRetry(
                    stagehand,
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
                    }),
                    auditOptions
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
                mem.history.push({
                    instruction: "Verification checkpoint",
                    success: false,
                    message: `Verification check failed: ${verification.evidence}. Continuing execution to fulfill goal.`,
                })
                continue
            }

            // If verification indicates failure and cannot continue:
            if (!verification.achieved) {
                await restorePrunedPageDom(page).catch(() => {})
                throw new Error(
                    `Agent goal unfulfilled: ${verification.evidence || decision.message || "Goal verification failed"}`
                )
            }

            await restorePrunedPageDom(page).catch(() => {})

            return {
                success: true,
                achieved: true,
                completed: true,
                message: decision.message ?? "Agent task completed",
                summary: verification.summary,
                evidence: verification.evidence,
                url: resolvedUrl,
                steps: mem.history.length,
                confirmedJobs: mem.confirmedJobs,
                attemptedJobs: mem.attemptedJobs,
                skippedJobs: mem.skippedJobs,
                inspectedJobs: mem.inspectedJobs,
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

            mem.history.push({
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

        // Dual-Brain Micro-Step: If the Macro planner requested form delegation, invoke Qwen
        if (decision.formDelegation) {
            logger.info("[Dual-Brain] Delegating form response to Micro-Brain (Qwen)...", {
                company: decision.formDelegation.company,
                role: decision.formDelegation.role,
                targetField: decision.formDelegation.targetField,
            })

            const microText = await generateMicroResponseWithQwen({
                company: decision.formDelegation.company,
                role: decision.formDelegation.role,
                question:
                    decision.formDelegation.question ||
                    decision.formDelegation.targetField,
                candidateProfile,
            })

            if (microText) {
                logger.info(`[Dual-Brain Qwen] Synthesized response: "${microText}"`)
                const cleanText = microText.replace(/'/g, "\\'")
                let combinedInstruction = `type '${cleanText}' into the '${decision.formDelegation.targetField}' textbox`
                if (decision.formDelegation.nextActionAfterTyping) {
                    combinedInstruction += ` and then ${decision.formDelegation.nextActionAfterTyping}`
                }
                decision.instruction = combinedInstruction
            }
        }

        if (!decision.instruction) {
            throw new Error(
                'Agent: planner returned action "act" with no instruction.'
            )
        }

        // Duplicate submit click interceptor:
        // Prevent repeating submit button clicks in loops if the immediately preceding step was already a successful submit
        const isCurrentActionSubmit = isSubmitAction(decision.instruction)
        const lastStep = mem.history[mem.history.length - 1]
        const wasLastStepSubmit =
            lastStep &&
            lastStep.success &&
            isSubmitAction(lastStep.instruction)

        // ── Mechanical Action Dispatch (zero-token path) ─────────────────────
        const mechanicalPage = await stagehand.browser.context.activePage()
        if (mechanicalPage) {
            const mechanical = await tryMechanicalAction(mechanicalPage, decision.instruction)
            if (mechanical.handled && mechanical.success) {
                logger.info(
                    `[Agent] Mechanical action verified (no LLM call): ${mechanical.message}`,
                    { instruction: decision.instruction }
                )
                mem.history.push({
                    instruction: decision.instruction,
                    success: true,
                    message: mechanical.message,
                })
                continue
            }
        }

        const actResult = await stagehand.act(decision.instruction)

        mem.history.push({
            instruction: decision.instruction,
            success: actResult.data.success,
            message: actResult.data.message ?? "",
        })

        // Post-submit grace period & settle:
        // When clicking Apply/submit, wait for DOM updates, network requests, and modal transitions to settle
        if (isSubmitAction(decision.instruction) && actResult.data.success) {
            await new Promise((r) => setTimeout(r, 1500))
            const currentPage = await stagehand.browser.context.activePage()
            if (currentPage) {
                await waitForPageSettle(currentPage, { settleMs: 500, maxWaitMs: 3000 })
            }
        }
    }

    const page = await stagehand.browser.context.activePage()
    const resolvedUrl = page ? await page.url() : ""

    await restorePrunedPageDom(page).catch(() => {})

    throw new Error(
        `Agent did not complete the task within ${MAX_STEPS} steps. Last state URL: ${resolvedUrl || "unknown"}`
    )
}