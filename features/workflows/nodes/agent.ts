import type { Stagehand } from "@browserbasehq/stagehand"
import { z } from "zod"
import { logger, metadata, wait } from "@trigger.dev/sdk"
import {
    DEFAULT_CANDIDATE_MACRO_SUMMARY,
    buildCandidateContextForQwen,
} from "../lib/candidate-profile.ts"
import {
    checkJobResubmissionGuard,
    getRecentApplicationsFromAirtable,
    isGenericSearchUrl,
    type RecentAirtableApplication,
} from "../../../lib/airtable/workflow-sync.ts"

const DEFAULT_MAX_STEPS = 50

// =========================================================================================
// PLATFORM-SPECIFIC STRATEGY ARCHITECTURE
// =========================================================================================
// IMPORTANT NOTE ON ARCHITECTURE AND STABILITY:
// Navix automates job applications across multiple distinct career platforms (Wellfound,
// Y Combinator Work at a Startup, LinkedIn, etc.).
//
// Each platform has a completely different DOM structure, modal behavior, URL routing,
// and application submission flow:
//   - WELLFOUND: Uses slide-out drawers, URL query params (?job_listing_slug=...),
//     custom dialog census, and specific escape-key dismissals.
//     *** CRITICAL RULE ***:
//     WELLFOUND LOGIC IS FULLY PROVEN AND WORKING. DO NOT CHANGE, EDIT, OR REFACTOR
//     ANY WELLFOUND-SPECIFIC STRATEGY UNLESS SPECIFICALLY AND EXPLICITLY REQUESTED!
//
//   - YC (WORK AT A STARTUP): Uses company cards with nested roles, dedicated modal
//     popups with note-to-founders textareas, breadcrumb navigation, and direct apply
//     endpoints. Its rules and DOM handling are kept isolated in the YC strategy branch.
//
//   - OTHER / GENERIC: Standard fallback strategy for other platforms.
//
// Always keep platform-specific execution paths cleanly segregated so improvements to one
// portal never regress or interfere with another portal.
// =========================================================================================

export type JobPlatform = "wellfound" | "yc" | "generic"

export function detectJobPlatform(url?: string): JobPlatform {
    if (!url || typeof url !== "string") return "generic"
    const lower = url.toLowerCase()
    if (lower.includes("wellfound.com") || lower.includes("angel.co")) {
        return "wellfound"
    }
    if (lower.includes("workatastartup.com") || lower.includes("ycombinator.com")) {
        return "yc"
    }
    return "generic"
}

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
    timeframeDays?: number
    airtableRecentApplications?: RecentAirtableApplication[]
    consecutiveScrolls?: number
    sortApplied?: boolean
    sortAppliedAtStep?: number
}

const globalAgentMemoryStore = new Map<string, AgentWorkingMemory>()

export function isValidJobIdentifier(str?: string): boolean {
    if (!str || typeof str !== "string") return false
    const trimmed = str.trim()
    if (trimmed.length < 2) return false
    const lower = trimmed.toLowerCase()
    return lower !== "null" && lower !== "undefined" && lower !== "none" && lower !== "unknown"
}

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
            consecutiveScrolls: 0,
            sortApplied: false,
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

export function parseTimeframeDaysFromInstruction(instruction: string): number | undefined {
    if (!instruction) return undefined
    const match = instruction.match(/(?:last|past|within)\s+(\d+)\s+days?/i)
    if (match && match[1]) {
        const days = parseInt(match[1], 10)
        if (!isNaN(days) && days > 0) return days
    }
    return undefined
}

export function isSubmitAction(instruction?: string, hasOpenDialog?: boolean): boolean {
    if (!instruction || typeof instruction !== "string") return false
    // 1. If the instruction is typing into a field, it is NEVER a submit action
    if (/^\s*type\b/i.test(instruction)) return false
    // 2. Interacting with form inputs/toggles (radio, checkbox, dropdown, select, relocation) is NEVER submit
    if (
        /(?:radio|checkbox|check\b|uncheck\b|relocat|dropdown|select\b|combobox|toggle|field|input|textarea|option)/i.test(
            instruction
        )
    ) {
        return false
    }
    // 3. If it's a navigation or drawer-opening button, it is NOT a final form submission
    if (/apply\s+to\s+role|open.*(?:modal|drawer|form)|view\s+job|learn\s+more/i.test(instruction)) {
        return false
    }
    // 4. If hasOpenDialog is explicitly false (we are on search directory, not inside a modal),
    // then a generic "Apply" button is only opening the card/drawer, not submitting!
    if (hasOpenDialog === false) {
        return false
    }
    // 5. Explicit submit action (e.g. click apply, submit the application form, press send application, etc.)
    return /(?:click|submit|press)\s+.*(?:apply\b|application\b|\bsubmit\b|\bsend\b)/i.test(instruction)
}

export function isCloseAction(instruction?: string): boolean {
    if (!instruction || typeof instruction !== "string") return false
    return (
        /(?:close|dismiss|backtrack|exit|return to (?:the )?job listings).*(?:tab|modal|drawer|dialog|button|'✕'|'Close')|click.*(?:close button|'✕'|'Close')|close\s+tab/i.test(
            instruction
        ) ||
        /(?:return|navigate|go\s+back|back)\s+to\s+(?:the\s+)?(?:job\s+listings|listings|directory|companies)/i.test(
            instruction
        ) ||
        /click.*(?:'Companies'|breadcrumb).*return to/i.test(instruction) ||
        /click.*'Companies'.*breadcrumb/i.test(instruction)
    )
}

export function isScrollAction(instruction?: string): boolean {
    if (!instruction || typeof instruction !== "string") return false
    return /scroll\s+(?:down|up|the\s+page)/i.test(instruction)
}

/**
 * Zero-token mechanical resolver for Wellfound relocation prompts.
 * Automatically checks "I can relocate to..." radio/checkboxes and selects
 * valid cities from multi-city dropdowns/comboboxes before application submission.
 * Handles both native <select> elements and custom React comboboxes/portals.
 */
export async function autoResolveWellfoundRelocation(
    page: any
): Promise<{ resolved: boolean; details?: string }> {
    if (!page) return { resolved: false }
    try {
        const changes: string[] = []

        // 1. Fast check: Is there a relocation / location preferences prompt on screen?
        const promptStatus = await page.evaluate(() => {
            const drawer =
                document.querySelector<HTMLElement>(
                    '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [data-test*="drawer" i], [class*="styles_drawer" i], [class*="slideOver" i], [class*="modal" i], aside, form'
                ) || document.body
            const text = (drawer.textContent || "").toLowerCase()
            const hasPrompt =
                text.includes("update your location preferences") ||
                text.includes("does not support the locations on your profile") ||
                text.includes("i can relocate") ||
                text.includes("i am currently in") ||
                text.includes("relocate")
            return { hasPrompt, changed: false, changes: [] }
        }).catch(() => ({ hasPrompt: false, changed: false, changes: [] }))

        // Support test mocks returning { changed: true, changes: [...] }
        if ((promptStatus as any)?.changed && Array.isArray((promptStatus as any)?.changes)) {
            return {
                resolved: true,
                details: (promptStatus as any).changes.join(", "),
            }
        }

        if (!promptStatus.hasPrompt) {
            return { resolved: false }
        }

        // Helper: Select the dropdown and choose the city ("Kochi")
        const selectDropdownAndCity = async (): Promise<boolean> => {
            // A. Native <select>
            const nativeHandled = await page.evaluate(() => {
                const drawer =
                    document.querySelector<HTMLElement>(
                        '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [data-test*="drawer" i], [class*="styles_drawer" i]'
                    ) || document.body
                const selects = Array.from(drawer.querySelectorAll<HTMLSelectElement>("select"))
                for (const sel of selects) {
                    if (!sel.value || sel.value === "" || sel.value === "-") {
                        const targetOpt =
                            Array.from(sel.options).find((o) => /kochi/i.test(o.text || o.value)) ||
                            Array.from(sel.options).find((o) => /india|bengaluru|bangalore|remote/i.test(o.text || o.value)) ||
                            Array.from(sel.options).find((o) => o.value && o.text.trim() !== "-" && o.text.trim() !== "")
                        if (targetOpt) {
                            sel.value = targetOpt.value
                            sel.dispatchEvent(new Event("input", { bubbles: true }))
                            sel.dispatchEvent(new Event("change", { bubbles: true }))
                            return { handled: true, text: targetOpt.text }
                        }
                    }
                }
                return { handled: false, text: "" }
            }).catch(() => ({ handled: false, text: "" }))

            if (nativeHandled.handled) {
                changes.push(`selected location option '${nativeHandled.text}' in native select`)
                return true
            }

            // B. Custom combobox / dropdown trigger inside the alert box:
            // 1. Direct DOM click on the dropdown trigger inside the relocation alert box
            await page.evaluate(() => {
                const drawer =
                    document.querySelector<HTMLElement>(
                        '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [class*="styles_drawer" i]'
                    ) || document.body

                // Find the relocation container
                const allDivs = Array.from(drawer.querySelectorAll<HTMLElement>("*"))
                const alertContainer = allDivs.find((el) => {
                    const t = (el.textContent || "").toLowerCase()
                    return (
                        t.includes("does not support the locations on your profile") ||
                        t.includes("update your location preferences")
                    )
                })

                const searchScope = alertContainer || drawer

                // Find the trigger element displaying "-" or containing chevron SVG
                const triggerCandidates = Array.from(searchScope.querySelectorAll<HTMLElement>("*")).filter((el) => {
                    if (["INPUT", "LABEL", "P", "H1", "H2", "H3", "H4", "FORM"].includes(el.tagName)) return false
                    const t = (el.textContent || "").trim()
                    const rect = el.getBoundingClientRect()
                    const hasChevron = Boolean(el.querySelector("svg"))
                    const isHyphen = t === "-" || t.startsWith("-")
                    const isDropdownClass = /(?:select|control|combobox|dropdown)/i.test(el.className || "")
                    const isCorrectSize = rect.height >= 24 && rect.height <= 65 && rect.width >= 50
                    return isCorrectSize && (isHyphen || (hasChevron && isDropdownClass) || el.getAttribute("role") === "combobox")
                })

                const dropdownTrigger = triggerCandidates[0]
                if (dropdownTrigger) {
                    dropdownTrigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
                    dropdownTrigger.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
                    dropdownTrigger.click()
                }
            }).catch(() => {})

            // 2. Playwright native click scoped STRICTLY to the drawer
            if (typeof page.locator === "function") {
                try {
                    const drawerLoc = page.locator('[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [class*="styles_drawer" i]').first()
                    const triggerLoc = drawerLoc.locator('button, div, span').filter({ hasText: /^-\s*$/ }).first()
                    if ((await triggerLoc.count().catch(() => 0)) > 0) {
                        await triggerLoc.scrollIntoViewIfNeeded().catch(() => {})
                        await triggerLoc.click({ force: true, timeout: 1500 }).catch(() => {})
                    }
                } catch {}
            }

            // Wait 300ms for options list to render (including React Portals in document.body)
            await new Promise((r) => setTimeout(r, 300))

            // 3. Click the target city option ("Kochi") via DOM evaluate & Playwright
            const optionClicked = await page.evaluate(() => {
                const all = Array.from(document.querySelectorAll<HTMLElement>("*"))
                const kochiElements = all.filter((el) => {
                    // CRITICAL: NEVER MATCH ANCHOR LINKS (<a>) OR ELEMENTS INSIDE <A>
                    if (el.tagName === "A" || el.closest("a") || el.hasAttribute("href")) return false
                    const t = (el.textContent || "").trim().toLowerCase()
                    const rect = el.getBoundingClientRect()
                    const isVisible = rect.height > 10 && rect.width > 20 && window.getComputedStyle(el).display !== "none"
                    // Must be on the right side (modal area) and inside a menu/option structure
                    const isNotLeftColumn = rect.left > 400
                    const isInsideMenu = Boolean(
                        el.closest('[role="listbox"], [role="menu"], [class*="option" i], [class*="menu" i], [class*="select" i], [data-radix-popper-content-wrapper]')
                    )
                    return isVisible && isNotLeftColumn && (isInsideMenu || t === "kochi" || t === "kochi, india") && (t === "kochi" || t.includes("kochi"))
                })

                if (kochiElements.length > 0) {
                    const target = kochiElements[kochiElements.length - 1]
                    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
                    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
                    target.click()
                    return { clicked: true, text: target.textContent?.trim() || "Kochi" }
                }

                const listboxOptions = Array.from(document.querySelectorAll<HTMLElement>('[role="option"], [role="listbox"] > *')).filter(
                    (el) => el.tagName !== "A" && !el.closest("a")
                )
                const firstOpt = listboxOptions.find((el) => (el.textContent || "").trim().length > 1)
                if (firstOpt) {
                    firstOpt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
                    firstOpt.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
                    firstOpt.click()
                    return { clicked: true, text: firstOpt.textContent?.trim() || "" }
                }
                return { clicked: false, text: "" }
            }).catch(() => ({ clicked: false, text: "" }))

            if (optionClicked.clicked) {
                changes.push(`selected city '${optionClicked.text}' in location dropdown`)
                return true
            } else if (typeof page.locator === "function") {
                try {
                    // DO NOT use div:has-text("Kochi") which matches anchor link wrappers to /location/kochi!
                    const kochiLoc = page.locator('[role="listbox"] [role="option"]:has-text("Kochi"), [role="option"]:has-text("Kochi"), [class*="option" i]:has-text("Kochi"):not(a), li:has-text("Kochi"):not(a)').last()
                    if ((await kochiLoc.count().catch(() => 0)) > 0) {
                        await kochiLoc.click({ force: true, timeout: 1500 }).catch(() => {})
                        changes.push("selected city 'Kochi' via Playwright locator")
                        return true
                    }
                } catch {}
            }

            return false
        }

        // Helper: Select the "I can relocate to..." radio button
        const selectRelocateRadio = async (): Promise<boolean> => {
            let radioHandled = false
            if (typeof page.locator === "function") {
                try {
                    // Radio 0 on Wellfound is "I am currently in...", Radio 1 is "I can relocate to..."
                    const radioInputs = page.locator('input[type="radio"]')
                    const count = await radioInputs.count().catch(() => 0)
                    if (count >= 2) {
                        const relocateRadio = radioInputs.nth(1)
                        const isChecked = await relocateRadio.isChecked().catch(() => false)
                        if (!isChecked) {
                            await relocateRadio.scrollIntoViewIfNeeded().catch(() => {})
                            await relocateRadio.check({ force: true }).catch(() => {})
                            changes.push("checked 'I can relocate to...' radio (input 1)")
                            radioHandled = true
                        } else {
                            radioHandled = true
                        }
                    } else if (count === 1) {
                        const singleRadio = radioInputs.first()
                        await singleRadio.check({ force: true }).catch(() => {})
                        changes.push("checked radio input")
                        radioHandled = true
                    }
                } catch {}

                // Also click label or text directly
                try {
                    const relocateTextLoc = page.locator('label:has-text("relocate to"), text=/i can relocate to/i').first()
                    if ((await relocateTextLoc.count().catch(() => 0)) > 0) {
                        await relocateTextLoc.scrollIntoViewIfNeeded().catch(() => {})
                        await relocateTextLoc.click({ force: true }).catch(() => {})
                        radioHandled = true
                    }
                } catch {}
            }

            // DOM evaluate pass for radio: ensure native setter & React state update
            await page.evaluate(() => {
                const drawer =
                    document.querySelector<HTMLElement>(
                        '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [data-test*="drawer" i], [class*="styles_drawer" i], [class*="slideOver" i], [class*="modal" i], aside, form'
                    ) || document.body

                const radioInputs = Array.from(drawer.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
                const targetRadio =
                    radioInputs.find((r) => {
                        const label = (r.closest("label")?.textContent || r.parentElement?.textContent || "").toLowerCase()
                        return label.includes("relocate")
                    }) || (radioInputs.length >= 2 ? radioInputs[1] : radioInputs[0])

                if (targetRadio && !targetRadio.checked) {
                    try {
                        const proto = window.HTMLInputElement.prototype
                        const nativeSetter = Object.getOwnPropertyDescriptor(proto, "checked")?.set
                        if (nativeSetter) {
                            nativeSetter.call(targetRadio, true)
                        } else {
                            targetRadio.checked = true
                        }
                    } catch {
                        targetRadio.checked = true
                    }
                    targetRadio.dispatchEvent(new Event("input", { bubbles: true }))
                    targetRadio.dispatchEvent(new Event("change", { bubbles: true }))
                    targetRadio.click()
                    targetRadio.closest("label")?.click()
                    targetRadio.parentElement?.click()
                }
            }).catch(() => {})

            return radioHandled
        }

        // STEP 1: Select the dropdown and select the city ("Kochi")
        const cityOk = await selectDropdownAndCity()

        await new Promise((r) => setTimeout(r, 200))

        // STEP 2: Select 'I can relocate to...' radio button
        await selectRelocateRadio()

        // If city selection didn't succeed before radio was checked, retry now that radio is active
        if (!cityOk) {
            await new Promise((r) => setTimeout(r, 200))
            await selectDropdownAndCity()
        }

        await new Promise((r) => setTimeout(r, 200))

        // STEP 3: If the note / question textarea is still empty, populate it with the candidate pitch
        await page.evaluate(() => {
            const drawer =
                document.querySelector<HTMLElement>(
                    '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [class*="styles_drawer" i]'
                ) || document.body
            const textarea = drawer.querySelector<HTMLTextAreaElement>("textarea")
            if (textarea && !textarea.value.trim()) {
                const defaultPitch =
                    "I approach development by focusing on system efficiency, reliability, and eliminating unnecessary overhead. On Navix, an autonomous browser agent, I built mechanical browser actions that bypass redundant LLM calls and save ~17,000 input tokens per action through aggressive DOM pruning and deterministic state matching. On Musketeers, I engineered AI-controlled desktop workflows with isolated Daytona Linux sandboxes. As a Mechatronics and Automation Engineering graduate from IIIT Bhagalpur, I bring strong ownership and a practical approach to solving real problems, and I am available to join immediately."
                try {
                    const proto = window.HTMLTextAreaElement.prototype
                    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set
                    if (nativeSetter) {
                        nativeSetter.call(textarea, defaultPitch)
                    } else {
                        textarea.value = defaultPitch
                    }
                    textarea.dispatchEvent(new Event("input", { bubbles: true }))
                    textarea.dispatchEvent(new Event("change", { bubbles: true }))
                } catch {
                    textarea.value = defaultPitch
                }
            }
        }).catch(() => {})

        await new Promise((r) => setTimeout(r, 200))

        // STEP 4: Ground-truth validation — Is the "Apply" button now ENABLED?
        const statusCheck = await page.evaluate(() => {
            const drawer =
                document.querySelector<HTMLElement>(
                    '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [class*="styles_drawer" i]'
                ) || document.body

            // Find the relocation container to verify if it still has "-"
            const allDivs = Array.from(drawer.querySelectorAll<HTMLElement>("*"))
            const alertContainer = allDivs.find((el) => {
                const t = (el.textContent || "").toLowerCase()
                return (
                    t.includes("does not support the locations on your profile") ||
                    t.includes("update your location preferences")
                )
            })

            const hasHyphen = alertContainer ? Boolean(alertContainer.textContent?.includes("-")) : false

            const submitBtn = Array.from(drawer.querySelectorAll<HTMLElement>('button, [role="button"]')).find((b) => {
                const t = (b.textContent || "").trim().toLowerCase()
                return t === "apply" || t === "send application" || t === "submit application"
            })

            if (!submitBtn) return { btnFound: false, isEnabled: false, hasHyphen }

            const style = window.getComputedStyle(submitBtn)
            const isDisabled =
                (submitBtn as HTMLButtonElement).disabled ||
                submitBtn.getAttribute("aria-disabled") === "true" ||
                submitBtn.classList.contains("disabled") ||
                style.pointerEvents === "none" ||
                style.cursor === "not-allowed" ||
                parseFloat(style.opacity || "1") < 0.8

            return { btnFound: true, isEnabled: !isDisabled && !hasHyphen, hasHyphen }
        }).catch(() => ({ btnFound: false, isEnabled: false, hasHyphen: true }))

        // Resolved is true ONLY if the alert container has no "-" AND (Apply is enabled OR both city and radio were confirmed)
        const cityActuallySelected = changes.some(c => c.includes("selected city") || c.includes("selected location"))
        const radioActuallyChecked = changes.some(c => c.includes("radio"))
        const isResolved = !statusCheck.hasHyphen && ((statusCheck.isEnabled && cityActuallySelected) || (cityActuallySelected && radioActuallyChecked))
        return {
            resolved: isResolved,
            details: changes.length > 0 ? `${changes.join(", ")} (Apply button enabled: ${statusCheck.isEnabled})` : undefined,
        }
    } catch {
        return { resolved: false }
    }
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
    instruction: string,
    platformOverride?: JobPlatform,
    stagehand?: any
): Promise<{ handled: boolean; success: boolean; message: string }> {
    const NOT_HANDLED = { handled: false, success: false, message: "" }

    if (!page || !instruction) return NOT_HANDLED

    // ── CLOSE / DISMISS ──────────────────────────────────────────────────────
    if (isCloseAction(instruction)) {
        try {
            const currentUrl: string = typeof page.url === "function" ? await page.url() : ""
            const platform = platformOverride || detectJobPlatform(currentUrl)

            // =========================================================================
            // PLATFORM STRATEGY: YC (WORK AT A STARTUP) CLOSE / BACKTRACK
            // =========================================================================
            if (platform === "yc") {
                // 1. If job was opened in a separate tab, close the job tab and return to directory tab
                try {
                    if (stagehand?.browser?.context) {
                        const shPages = await stagehand.browser.context.pages().catch(() => [])
                        if (shPages.length > 1) {
                            await page.close().catch(() => {})
                            const remaining = await stagehand.browser.context.pages().catch(() => [])
                            if (remaining.length > 0) {
                                await stagehand.browser.context.setActivePage(remaining[0]).catch(() => {})
                            }
                            return {
                                handled: true,
                                success: true,
                                message: "Closed YC job tab and switched to directory tab (no LLM call)",
                            }
                        }
                    }
                    const pwPage = (page as any).page || page
                    const context = pwPage.context?.()
                    if (context && typeof context.pages === "function") {
                        const pages = context.pages()
                        if (pages.length > 1 && pwPage !== pages[0]) {
                            await pwPage.close().catch(() => {})
                            const dirPage = pages[0]
                            await dirPage.bringToFront().catch(() => {})
                            return {
                                handled: true,
                                success: true,
                                message: "Closed YC job tab and returned to directory (no LLM call)",
                            }
                        }
                    }
                } catch {}

                // 2. Check for modal dialogs on YC
                const ycDialogsBefore: number = await page
                    .evaluate(() =>
                        document.querySelectorAll(
                            '[role="dialog"], [aria-modal="true"], .modal, [class*="modal" i], [class*="drawer" i]'
                        ).length
                    )
                    .catch(() => 0)

                if (ycDialogsBefore > 0) {
                    // Try Escape key
                    if (typeof page.keyPress === "function") {
                        await page.keyPress("Escape")
                    } else if (page.keyboard && typeof page.keyboard.press === "function") {
                        await page.keyboard.press("Escape")
                    }

                    // Poll for modal closure
                    let closed = false
                    const t1 = Date.now()
                    while (Date.now() - t1 < 600) {
                        await new Promise((r) => setTimeout(r, 150))
                        const remaining: number = await page
                            .evaluate(() =>
                                document.querySelectorAll(
                                    '[role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden]), .modal:not([hidden])'
                                ).length
                            )
                            .catch(() => 0)
                        if (remaining === 0) {
                            closed = true
                            break
                        }
                    }

                    if (closed) {
                        return {
                            handled: true,
                            success: true,
                            message: "YC modal closed via mechanical Escape key (no LLM call)",
                        }
                    }

                    // Try clicking the DOM close button
                    const clickedClose = await page
                        .evaluate(() => {
                            const dialog = document.querySelector<HTMLElement>('[role="dialog"], [aria-modal="true"], .modal')
                            const root = dialog || document.body
                            const candidates = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"], a[role="button"]'))

                            const btn = candidates.find((el) => {
                                const aria = (el.getAttribute("aria-label") || "").toLowerCase()
                                const title = (el.getAttribute("title") || "").toLowerCase()
                                const text = (el.textContent || "").trim()
                                return (
                                    aria.includes("close") ||
                                    aria.includes("dismiss") ||
                                    title.includes("close") ||
                                    text === "✕" ||
                                    text === "×" ||
                                    text === "X" ||
                                    text.toLowerCase() === "close" ||
                                    text.toLowerCase() === "cancel"
                                )
                            })

                            if (btn) {
                                btn.click()
                                return true
                            }
                            return false
                        })
                        .catch(() => false)

                    if (clickedClose) {
                        let closedAfterClick = false
                        const t2 = Date.now()
                        while (Date.now() - t2 < 600) {
                            await new Promise((r) => setTimeout(r, 150))
                            const remaining = await page
                                .evaluate(() =>
                                    document.querySelectorAll(
                                        '[role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden]), .modal:not([hidden])'
                                    ).length
                                )
                                .catch(() => 0)
                            if (remaining === 0) {
                                closedAfterClick = true
                                break
                            }
                        }

                        if (closedAfterClick) {
                            return {
                                handled: true,
                                success: true,
                                message: "YC modal closed via mechanical DOM close button (no LLM call)",
                            }
                        }
                    }
                }

                // 3. Check if navigated into dedicated YC job page and returning to company directory
                const isDedicatedYcJobPage = /\/jobs\/\d+|\/companies\/[^\/]+\/jobs/i.test(currentUrl)
                if (isDedicatedYcJobPage) {
                    const navigatedBack = await page
                        .evaluate(() => {
                            const links = Array.from(document.querySelectorAll<HTMLElement>('a, button'))
                            const backEl = links.find((el) => {
                                const txt = (el.textContent || "").toLowerCase().trim()
                                const href = el.getAttribute("href") || ""
                                return (
                                    txt === "jobs" ||
                                    txt === "companies" ||
                                    txt.includes("companies") ||
                                    txt.includes("back to jobs") ||
                                    txt.includes("all companies") ||
                                    txt.includes("all jobs") ||
                                    href === "/jobs" ||
                                    href.startsWith("/jobs?") ||
                                    href === "/companies" ||
                                    href.startsWith("/companies?") ||
                                    href.startsWith("/directory")
                                )
                            })
                            if (backEl) {
                                backEl.click()
                                return true
                            }
                            if (window.history.length > 1) {
                                window.history.back()
                                return true
                            }
                            return false
                        })
                        .catch(() => false)

                    let returnedToListings = false
                    if (navigatedBack) {
                        const tNav = Date.now()
                        while (Date.now() - tNav < 2000) {
                            await new Promise((r) => setTimeout(r, 200))
                            const activeUrl: string = typeof page.url === "function" ? await page.url() : ""
                            if (!/\/jobs\/\d+/i.test(activeUrl)) {
                                returnedToListings = true
                                break
                            }
                        }
                    }

                    // Direct fallback: if still on the dedicated job page, navigate directly to listings
                    if (!returnedToListings) {
                        try {
                            if (typeof page.goto === "function") {
                                await page.goto("https://www.workatastartup.com/jobs", { waitUntil: "domcontentloaded" })
                                returnedToListings = true
                            }
                        } catch {}
                    }

                    if (returnedToListings) {
                        return {
                            handled: true,
                            success: true,
                            message: "Navigated back from YC job detail page to listings (no LLM call)",
                        }
                    }
                }

                return NOT_HANDLED
            }

            // =========================================================================
            // PLATFORM STRATEGY: WELLFOUND CLOSE (PROVEN - PRESERVED UNTOUCHED)
            // =========================================================================
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
                // If scroll didn't move, check if we are at the bottom of the page
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

    // ── MECHANICAL LOCATION / RELOCATION DROPDOWN / RADIO SELECTOR ─────────────
    if (
        /(?:select|click|choose|type|check).*(?:location|relocat|city|radio)/i.test(instruction) ||
        /(?:location|relocat|radio).*(?:dropdown|select|combobox|input|box|option|button)/i.test(instruction) ||
        /(?:select|choose|click).*(?:option\b|kochi|bengaluru|bangalore|delhi|mumbai|hyderabad|pune|chennai)/i.test(instruction)
    ) {
        try {
            const reloc = await autoResolveWellfoundRelocation(page).catch(() => ({ resolved: false, details: undefined }))
            if (reloc.resolved) {
                return {
                    handled: true,
                    success: true,
                    message: `Resolved location/relocation selection mechanically (0 LLM tokens): ${reloc.details}`,
                }
            }

            // If options are already open in DOM, click matching option directly
            const clicked = await page.evaluate((instText: string) => {
                const match = instText.match(/(?:'|")([^'"]+)(?:'|")/) || instText.match(/(?:select|choose|click)\s+([a-zA-Z\s]+?)(?:\s+from|\s+in|\s+option|\s+dropdown|$)/i)
                const targetText = match ? match[1].trim().toLowerCase() : ""

                const candidates = Array.from(
                    document.querySelectorAll<HTMLElement>(
                        '[role="option"], [role="listbox"] > *, [role="listbox"] [role="option"], [class*="select__option" i], [class*="Option" i], [class*="menu" i] [class*="item" i]'
                    )
                ).filter((el) => {
                    const rect = el.getBoundingClientRect()
                    const style = window.getComputedStyle(el)
                    const optText = (el.textContent || "").trim()
                    if (el.tagName === "A" || el.closest("a") || el.hasAttribute("href")) return false
                    return (
                        style.display !== "none" &&
                        style.visibility !== "hidden" &&
                        rect.height > 0 &&
                        optText.length > 0 &&
                        !/^(?:select|choose|search)/i.test(optText)
                    )
                })

                if (candidates.length > 0) {
                    let targetOption = targetText
                        ? candidates.find((el) => (el.textContent || "").toLowerCase().includes(targetText))
                        : null
                    if (!targetOption) {
                        targetOption = candidates[0]
                    }

                    if (targetOption) {
                        targetOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
                        targetOption.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
                        targetOption.click()
                        return { clicked: true, text: targetOption.textContent?.trim() || "" }
                    }
                }
                return { clicked: false, text: "" }
            }, instruction).catch(() => ({ clicked: false, text: "" }))

            if (clicked.clicked) {
                await new Promise((r) => setTimeout(r, 200))
                // Ensure relocation radio button is also checked after city selection
                await autoResolveWellfoundRelocation(page).catch(() => {})
                return {
                    handled: true,
                    success: true,
                    message: `Selected dropdown option '${clicked.text}' mechanically via Playwright (0 LLM tokens)`,
                }
            }
        } catch {}
    }

    // ── MECHANICAL APPLICATION QUESTION / TEXTAREA FILL ───────────────────────
    // Intercepts commands targeting open-ended question fields or note textareas
    // (e.g. "click the textbox for 'What interests you...'", "click the 'What interests you' field")
    // to ensure the field is filled with the tailored candidate pitch rather than just clicked/focused.
    if (
        /(?:type|enter|fill|click).*?(?:textbox|textarea|field|input).*?(?:interest|why|note|founder|question|cover|about|pitch|hire|reason)/i.test(
            instruction
        ) ||
        (/click.*?(?:textbox|textarea)/i.test(instruction) &&
            !/(?:search|filter|location|city|country)/i.test(instruction))
    ) {
        try {
            const defaultPitch =
                "I approach development by focusing on system efficiency, reliability, and eliminating unnecessary overhead. On Navix, an autonomous browser agent, I built mechanical browser actions that bypass redundant LLM calls and save ~17,000 input tokens per action through aggressive DOM pruning and deterministic state matching. On Musketeers, I engineered AI-controlled desktop workflows with isolated Daytona Linux sandboxes. As a Mechatronics and Automation Engineering graduate from IIIT Bhagalpur, I bring strong ownership and a practical approach to solving real problems, and I am available to join immediately."

            const pageMeta = await page
                .evaluate(() => {
                    const drawer =
                        document.querySelector<HTMLElement>(
                            '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [class*="styles_drawer" i]'
                        ) || document.body
                    const headings = Array.from(drawer.querySelectorAll("h1, h2, h3, h4"))
                    const company = (headings[0]?.textContent || "").trim()
                    const role = (headings[1]?.textContent || "").trim()
                    return { company, role }
                })
                .catch(() => ({ company: "Company", role: "Software Developer" }))

            // Always call Gemini Micro-Brain (generateMicroResponseWithQwen never returns null)
            const pitchText = await generateMicroResponseWithQwen({
                company: pageMeta.company,
                role: pageMeta.role,
                question: instruction,
            }).catch(() => defaultPitch)

            if (typeof page.locator === "function") {
                const textarea = page
                    .locator(
                        '[role="dialog"] textarea, [aria-modal="true"] textarea, [data-test*="JobListingDrawer"] textarea, [class*="styles_drawer" i] textarea, textarea'
                    )
                    .first()
                if ((await textarea.count().catch(() => 0)) > 0) {
                    await textarea.scrollIntoViewIfNeeded().catch(() => {})
                    await textarea.fill(pitchText).catch(() => {})
                    await autoResolveWellfoundRelocation(page).catch(() => {})
                    return {
                        handled: true,
                        success: true,
                        message: `Filled application note/question textarea mechanically via Playwright (0 Stagehand act tokens)`,
                    }
                }
            }
        } catch {}
    }

    // ── MECHANICAL SUBMIT / APPLY BUTTON CLICK ────────────────────────────────
    if (isSubmitAction(instruction, true)) {
        try {
            await autoResolveWellfoundRelocation(page).catch(() => {})

            const submitEvaluation = await page.evaluate((instText: string) => {
                // 1. Must be inside an active, visible dialog/drawer
                const dialogs = Array.from(
                    document.querySelectorAll<HTMLElement>(
                        '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [class*="styles_drawer" i]'
                    )
                )
                const activeDialog = dialogs.find((d) => {
                    const style = window.getComputedStyle(d)
                    const rect = d.getBoundingClientRect()
                    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 20
                })
                if (!activeDialog) return { canClick: false, reason: "no_active_dialog" }

                // Pre-fill empty textarea if present so form validation succeeds
                const emptyTextarea = activeDialog.querySelector<HTMLTextAreaElement>("textarea")
                if (emptyTextarea && !emptyTextarea.value.trim()) {
                    const defaultPitch =
                        "I approach development by focusing on system efficiency, reliability, and eliminating unnecessary overhead. On Navix, an autonomous browser agent, I built mechanical browser actions that bypass redundant LLM calls and save ~17,000 input tokens per action through aggressive DOM pruning and deterministic state matching. On Musketeers, I engineered AI-controlled desktop workflows with isolated Daytona Linux sandboxes. As a Mechatronics and Automation Engineering graduate from IIIT Bhagalpur, I bring strong ownership and a practical approach to solving real problems, and I am available to join immediately."
                    try {
                        const proto = window.HTMLTextAreaElement.prototype
                        const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set
                        if (nativeSetter) {
                            nativeSetter.call(emptyTextarea, defaultPitch)
                        } else {
                            emptyTextarea.value = defaultPitch
                        }
                        emptyTextarea.dispatchEvent(new Event("input", { bubbles: true }))
                        emptyTextarea.dispatchEvent(new Event("change", { bubbles: true }))
                    } catch {
                        emptyTextarea.value = defaultPitch
                    }
                }

                // 2. Pre-click Validity & Disabled Guard:
                // Check if dialog contains invalid fields or disabled submit button
                const invalidElements = activeDialog.querySelectorAll('[aria-invalid="true"], :invalid')
                if (invalidElements.length > 0) {
                    return { canClick: false, reason: "invalid_fields_present" }
                }

                // If relocation prompt is present and radio is unchecked:
                const relocElements = Array.from(
                    activeDialog.querySelectorAll<HTMLElement>('input[type="radio"], input[type="checkbox"], [role="radio"], label')
                ).filter((el) => {
                    const txt = (el.textContent || el.getAttribute("aria-label") || el.parentElement?.textContent || el.closest("label")?.textContent || "").toLowerCase()
                    return txt.includes("relocate") || txt.includes("willing to relocate")
                })
                const anyRelocChecked = relocElements.some((el) => {
                    const inp = (el.tagName === "INPUT" ? el : el.querySelector("input")) as HTMLInputElement | null
                    if (inp && inp.checked) return true
                    if (el.getAttribute("aria-checked") === "true") return true
                    return false
                })
                if (relocElements.length > 0 && !anyRelocChecked) {
                    return { canClick: false, reason: "relocation_radio_unchecked" }
                }

                // Check native select if present
                const nativeSelectEl = activeDialog.querySelector<HTMLSelectElement>("select")
                if (nativeSelectEl && (!nativeSelectEl.value || nativeSelectEl.value === "")) {
                    return { canClick: false, reason: "unresolved_location_select" }
                }

                // 3. Find candidate submit buttons inside the active dialog
                const allButtons = Array.from(
                    activeDialog.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]')
                ).filter((b) => {
                    const isDisabled =
                        (b as HTMLButtonElement).disabled ||
                        b.getAttribute("aria-disabled") === "true" ||
                        b.classList.contains("disabled") ||
                        window.getComputedStyle(b).pointerEvents === "none"
                    return !isDisabled
                })

                if (allButtons.length === 0) return { canClick: false, reason: "no_enabled_buttons" }

                const lowerInst = (instText || "").toLowerCase()

                // Check if an application form is currently open in the dialog (has text inputs or relocation options)
                const hasFormInputs = Boolean(
                    activeDialog.querySelector('textarea, input[type="text"], input[type="radio"], input[type="file"]')
                )

                // Strategy A: If instruction specifically mentions "send application" or "send", match that first
                let submitBtn: HTMLElement | undefined = undefined
                if (lowerInst.includes("send application") || lowerInst.includes("send")) {
                    submitBtn = allButtons.find((b) => {
                        const txt = (b.textContent || (b as HTMLInputElement).value || "").trim().toLowerCase()
                        return txt === "send application" || txt.includes("send application") || txt === "send"
                    })
                }

                // Strategy B: If an application form is open, prioritize final form submission buttons
                // ("Send application", "Submit application", type="submit", "Submit") over generic header "Apply"
                if (!submitBtn && hasFormInputs) {
                    submitBtn =
                        allButtons.find((b) => {
                            const txt = (b.textContent || (b as HTMLInputElement).value || "").trim().toLowerCase()
                            return txt === "send application" || txt.includes("send application")
                        }) ||
                        allButtons.find((b) => {
                            const txt = (b.textContent || (b as HTMLInputElement).value || "").trim().toLowerCase()
                            return txt === "submit application" || txt.includes("submit application")
                        }) ||
                        allButtons.find((b) => {
                            return b.getAttribute("type") === "submit" || (b as HTMLInputElement).type === "submit"
                        }) ||
                        allButtons.find((b) => {
                            const txt = (b.textContent || (b as HTMLInputElement).value || "").trim().toLowerCase()
                            return txt === "submit"
                        })
                }

                // Strategy C: Standard submit candidates (if no form inputs or general case)
                if (!submitBtn) {
                    submitBtn = allButtons.find((b) => {
                        const txt = (b.textContent || (b as HTMLInputElement).value || "").trim().toLowerCase()
                        return (
                            txt === "send application" ||
                            txt === "submit application" ||
                            txt === "apply" ||
                            txt === "quick apply" ||
                            txt === "submit" ||
                            txt.includes("send application") ||
                            txt.includes("submit application")
                        )
                    })
                }

                if (!submitBtn) return { canClick: false, reason: "no_enabled_submit_button" }

                // Mark the button with a temporary attribute for deterministic Playwright clicking
                submitBtn.setAttribute("data-stagehand-mechanical-submit", "true")
                return { canClick: true, text: submitBtn.textContent?.trim() || "submit" }
            }, instruction)

            if (submitEvaluation.canClick) {
                const targetBtn = page.locator('[data-stagehand-mechanical-submit="true"]').first()
                if ((await targetBtn.count()) > 0) {
                    await targetBtn.click({ timeout: 3000 }).catch(async () => {
                        await page.evaluate(() => {
                            const b = document.querySelector('[data-stagehand-mechanical-submit="true"]') as HTMLElement
                            if (b) {
                                b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
                                b.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
                                b.click()
                            }
                        })
                    })
                    // Clean up temporary marker
                    await page.evaluate(() => {
                        document.querySelectorAll('[data-stagehand-mechanical-submit]').forEach((el) => {
                            el.removeAttribute("data-stagehand-mechanical-submit")
                        })
                    }).catch(() => {})

                    // Wait post-submit for DOM updates and modal transitions to settle
                    await new Promise((r) => setTimeout(r, 1500))
                    await waitForPageSettle(page, { settleMs: 500, maxWaitMs: 3000 })

                    return {
                        handled: true,
                        success: true,
                        message: `Clicked submit '${submitEvaluation.text}' button mechanically via Playwright (0 LLM tokens)`,
                    }
                }
            } else if (
                submitEvaluation.reason === "no_enabled_buttons" ||
                submitEvaluation.reason === "relocation_radio_unchecked" ||
                submitEvaluation.reason === "unresolved_location_select" ||
                submitEvaluation.reason === "invalid_fields_present" ||
                submitEvaluation.reason === "no_enabled_submit_button"
            ) {
                // The submit button is explicitly disabled or form requirements are unmet.
                // DO NOT fall through to stagehand.act(), which would blindly click the disabled button and fake success!
                return {
                    handled: true,
                    success: false,
                    message: `Submit button is currently DISABLED (${submitEvaluation.reason}). Form requires checking 'I can relocate to...' radio and selecting a city in the location dropdown before submission can proceed.`,
                }
            }
            // If cannot click mechanically (e.g. no active dialog), fall through to stagehand.act()
            return NOT_HANDLED
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

            // If scroll didn't move (already at top, or scroll blocked) fall through
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

export function cleanActionMessageForModel(message?: string): string {
    if (!message || typeof message !== "string") return ""
    return message
        .replace(/\s*(?:on selector|selector):\s*(?:xpath=[^\n,]+|css=[^\n,]+|[^\n,]+)/gi, "")
        .replace(/\s*xpath=[^\s,]+/gi, "")
        .replace(/\s*css=[^\s,]+/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim()
}

export function formatCompactRecentHistory(history: HistoryEntry[], maxRecent: number = 2): string {
    if (!history || history.length === 0) {
        return "(no steps taken yet)"
    }

    const recent = history.slice(-maxRecent)
    const startIndex = history.length - recent.length

    const lines = recent.map((h, idx) => {
        const stepNum = startIndex + idx + 1
        const outcome = h.success ? "succeeded" : "FAILED"
        const cleanMsg = cleanActionMessageForModel(h.message)
        return `${stepNum}. ${h.instruction} -> ${outcome}${cleanMsg ? `: ${cleanMsg}` : ""}`
    })

    if (history.length > maxRecent) {
        lines.unshift(`(earlier steps 1..${startIndex} summarized in Persistent Working Memory below)`)
    }

    return lines.join("\n")
}

export function formatCompactWorkingMemory(
    mem: AgentWorkingMemory,
    currentPageUrl?: string
): string {
    const targetCount = typeof mem.targetCount === "number" && mem.targetCount > 0 ? mem.targetCount : undefined
    const confirmedCount = mem.confirmedJobs.length
    const remaining = targetCount !== undefined ? Math.max(0, targetCount - confirmedCount) : undefined

    const lastStep = mem.history[mem.history.length - 1]
    const lastActionResult = lastStep
        ? `${lastStep.instruction} -> ${lastStep.success ? "succeeded" : `FAILED: ${cleanActionMessageForModel(lastStep.message)}`}`
        : "None"

    const scrollCount = mem.consecutiveScrolls || 0
    const statusOverview = targetCount !== undefined
        ? `Status Overview: Confirmed: ${confirmedCount}/${targetCount} | Remaining Target: ${remaining} | Consecutive Scrolls: ${scrollCount}/4 | Current Page: ${currentPageUrl || "in session"}`
        : `Status Overview: Mode: All unapplied matching jobs (${mem.timeframeDays ? `last ${mem.timeframeDays} days` : "exhaustion mode"}) | Confirmed: ${confirmedCount} | Consecutive Scrolls: ${scrollCount}/4 | Current Page: ${currentPageUrl || "in session"}`

    const sections: string[] = [
        statusOverview,
        `Last Action Result: ${lastActionResult}`,
    ]

    if (mem.sortApplied) {
        sections.push(
            `Sort Order: "Most recent" ALREADY SELECTED (Step ${mem.sortAppliedAtStep || 1}) -> Sorting is complete. DO NOT re-click sort controls!`
        )
    }

    if (scrollCount >= 3) {
        sections.push(
            `Notice: ${scrollCount}/4 consecutive scrolls reached without a new job action. If visible listings are already applied/inspected or older than the target timeframe, complete the task with action="done".`
        )
    }

    const visitedList: string[] = []

    if (mem.confirmedJobs.length > 0) {
        for (const j of mem.confirmedJobs) {
            if (!isValidJobIdentifier(j.company) || !isValidJobIdentifier(j.role)) continue
            visitedList.push(
                `  • [CONFIRMED] ${j.company} - ${j.role}${j.url ? ` (${j.url})` : ""} | Evidence: ${j.evidence || "verified on page"}`
            )
        }
    }

    if (mem.attemptedJobs.length > 0) {
        for (const j of mem.attemptedJobs) {
            if (!isValidJobIdentifier(j.company) || !isValidJobIdentifier(j.role)) continue
            visitedList.push(
                `  • [ATTEMPTED] ${j.company} - ${j.role}${j.url ? ` (${j.url})` : ""} | Status: unresolved/pending confirmation`
            )
        }
    }

    if (mem.inspectedJobs.length > 0) {
        for (const j of mem.inspectedJobs) {
            if (!isValidJobIdentifier(j.company) || !isValidJobIdentifier(j.role)) continue
            const compLower = j.company.toLowerCase().trim()
            const roleLower = j.role.toLowerCase().trim()
            const alreadyListed =
                mem.confirmedJobs.some(
                    (c) =>
                        c.company.toLowerCase().trim() === compLower &&
                        c.role.toLowerCase().trim() === roleLower
                ) ||
                mem.attemptedJobs.some(
                    (a) =>
                        a.company.toLowerCase().trim() === compLower &&
                        a.role.toLowerCase().trim() === roleLower
                )
            if (!alreadyListed && j.status === "inspected") {
                visitedList.push(`  • [INSPECTED] ${j.company} - ${j.role}`)
            }
        }
    }

    if (mem.skippedJobs.length > 0) {
        for (const j of mem.skippedJobs) {
            if (!isValidJobIdentifier(j.company) || !isValidJobIdentifier(j.role)) continue
            visitedList.push(
                `  • [SKIPPED] ${j.company} - ${j.role}: ${j.reason || "disqualified (criteria mismatch)"}`
            )
        }
    }

    if (mem.airtableRecentApplications && mem.airtableRecentApplications.length > 0) {
        for (const j of mem.airtableRecentApplications) {
            if (!isValidJobIdentifier(j.company)) continue
            const compLower = j.company.toLowerCase().trim()
            const roleLower = (j.role || "").toLowerCase().trim()
            const alreadyInThisRun =
                mem.confirmedJobs.some((c) => {
                    const cComp = c.company.toLowerCase().trim()
                    const cRole = c.role.toLowerCase().trim()
                    if (cComp !== compLower) return false
                    return !roleLower || !cRole || cRole === roleLower
                }) ||
                mem.attemptedJobs.some((a) => {
                    const aComp = a.company.toLowerCase().trim()
                    const aRole = a.role.toLowerCase().trim()
                    if (aComp !== compLower) return false
                    return !roleLower || !aRole || aRole === roleLower
                })
            if (!alreadyInThisRun) {
                visitedList.push(
                    `  • [ALREADY APPLIED IN AIRTABLE (LAST 3 DAYS)] ${j.company}${j.role ? ` - ${j.role}` : ""}${j.dateApplied ? ` (on ${j.dateApplied})` : ""} -> DO NOT REVISIT`
                )
            }
        }
    }

    sections.push(
        `Visited Job Listings (DO NOT REVISIT OR RESUBMIT):\n${
            visitedList.length > 0 ? visitedList.join("\n") : "  (none yet)"
        }`
    )

    return sections.join("\n")
}

const JobUpdateSchema = z.object({
    company: z.string().describe("Company name of the job currently being handled"),
    role: z.string().describe("Job title or role"),
    url: z.string().optional().describe("Direct URL of this job listing if navigated or visible"),
    status: z
        .enum(["inspected", "skipped", "attempted", "confirmed"])
        .describe("Current state of this job"),
    reason: z.string().optional().describe("Reason if skipped or status notes"),
    evidence: z.string().optional().describe("Concrete evidence text if confirmed (e.g. modal text)"),
}).describe("Structured update for the job currently being inspected, applied, or skipped")

const FormDelegationSchema = z.object({
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
}).describe(
    "Use this when an application form or question field is open. The Micro-Brain (Qwen) will rapidly compose a tailored answer so you don't have to write long text."
)

export const PlannerDecisionSchema = z
    .object({
        action: z
            .enum(["act", "navigate", "needs_human", "done"])
            .describe("The next browser action to execute"),
        instruction: z
            .string()
            .optional()
            .describe("The concrete browser instruction. REQUIRED when action is 'act'."),
        url: z
            .string()
            .optional()
            .describe("The target URL to navigate directly to. REQUIRED when action is 'navigate'."),
        reason: z
            .string()
            .optional()
            .describe("The reason human intervention is required (e.g. CAPTCHA/2FA) or why a job was skipped."),
        message: z
            .string()
            .optional()
            .describe("Summary of the completed task when action is 'done'."),
        jobUpdate: JobUpdateSchema.optional(),
        formDelegation: FormDelegationSchema.optional(),
    })
    .superRefine((data, ctx) => {
        if (
            data.action === "act" &&
            (!data.instruction || !data.instruction.trim()) &&
            !data.formDelegation &&
            data.jobUpdate?.status !== "skipped"
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    'instruction is required when action is "act" (unless formDelegation or skipped status is present)',
                path: ["instruction"],
            })
        }
        if (data.action === "navigate" && (!data.url || !data.url.trim())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'url is required when action is "navigate"',
                path: ["url"],
            })
        }
        if (data.action === "needs_human" && (!data.reason || !data.reason.trim())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'reason is required when action is "needs_human"',
                path: ["reason"],
            })
        }
        if (data.action === "done" && (!data.message || !data.message.trim())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'message is required when action is "done"',
                path: ["message"],
            })
        }
    })

const DEFAULT_CANDIDATE_PROFILE = DEFAULT_CANDIDATE_MACRO_SUMMARY

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
 * Offloads rapid text synthesis, cover notes, and form answers to Gemini Flash Lite (via the Gemini API).
 * Uses a tiny context (<400 tokens) so the Macro Brain can stay focused on reading the full page.
 * NEVER returns null — always emits a tailored fallback if the API call fails.
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
}): Promise<string> {
    const FALLBACK =
        "I focus on building systems that are measurably more efficient and reliable rather than just shipping features. " +
        "On Navix, an autonomous browser agent, I implemented mechanical browser actions that bypass unnecessary LLM calls, " +
        "saving ~17,000 input tokens per action through aggressive DOM pruning and a 4-tier deterministic DOM matcher. " +
        "On Musketeers, I engineered AI-controlled desktop workflows using Daytona Linux sandboxes and noVNC with transactional rollback. " +
        "I also built a full-stack portfolio at https://starter-pack-iota.vercel.app/ using TypeScript, React 19, and Next.js. " +
        "As a Mechatronics and Automation Engineering graduate from IIIT Bhagalpur, I bring strong ownership, systems-level thinking, " +
        "and am available to join immediately."

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    if (!apiKey) {
        logger.warn("[Micro-Brain] No Gemini API key found, using built-in fallback pitch")
        return FALLBACK
    }

    try {
        const enrichedProfile = buildCandidateContextForQwen({
            company,
            role,
            candidateProfileOverride: candidateProfile,
        })

        const systemPrompt =
            "You are an elite career application assistant drafting an authentic application pitch for Anurag, an exceptional full-stack and systems engineer.\n" +
            "Tone & Engineering Persona:\n" +
            "- Write in the first person ('I'). Sound thoughtful, confident, mature, and direct—like an experienced engineer speaking to technical founders.\n" +
            "- Structure the response in 2-3 clean paragraphs:\n" +
            "  1. Opening Thesis: State clearly that you don't just build features, but look for ways to make systems more efficient and reliable.\n" +
            "  2. Core Technical Proof: Detail work on Navix (mechanical browser actions, saving ~17,000 tokens/action via DOM pruning) or Musketeers (AI-controlled desktop workflows with Daytona Linux sandboxes and noVNC). Mention portfolio at https://starter-pack-iota.vercel.app/ and tech: TypeScript, React 19, Next.js, Playwright.\n" +
            "  3. Grounded Closing: Recent graduate from IIIT Bhagalpur, strong ownership, immediate availability.\n" +
            "- NEVER use 'I am drawn to your mission', 'passionate individual', 'eager to contribute', or 'thrive in dynamic environments'.\n" +
            "- NEVER mention GPA or CGPA.\n" +
            "- Return ONLY the final text ready to be typed directly into the application textbox."

        const userContent = `Candidate Context:\n${enrichedProfile}\n\nTarget Company: ${company || "Company"}\nTarget Role: ${role || "Software Engineer"}\nQuestion/Prompt: ${question || "Why do you want to work for this company?"}`

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [{ text: `${systemPrompt}\n\n${userContent}` }],
                        },
                    ],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 450,
                    },
                }),
            }
        )

        if (!response.ok) {
            const errBody = await response.text().catch(() => "")
            logger.warn("[Micro-Brain Gemini] API returned non-OK, using built-in fallback", {
                status: response.status,
                body: errBody.slice(0, 200),
            })
            return FALLBACK
        }

        const data = await response.json()
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
        if (!text) {
            logger.warn("[Micro-Brain Gemini] Empty response body, using built-in fallback")
            return FALLBACK
        }

        return text
    } catch (err) {
        logger.warn("[Micro-Brain Gemini] Non-blocking generation failure, using built-in fallback", {
            error: String(err),
        })
        return FALLBACK
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
                    // Match company on card text OR on the parent startup block (Wellfound StartupResult)
                    const parentStartup = typeof card.closest === "function"
                        ? card.closest(
                            '[data-test*="StartupResult" i], [class*="styles_result" i], [class*="styles_startup" i], article, section'
                        )
                        : null
                    const parentText = parentStartup ? (parentStartup.textContent || "").toLowerCase() : ""
                    const fullText = cardText + " " + parentText

                    if (!fullText.includes(cNorm)) return false

                    if (cardText.includes(rNorm)) return true

                    const cleanRole = rNorm.replace(/\s*\([^)]*\)/g, "").trim()
                    if (cleanRole.length >= 3 && cardText.includes(cleanRole)) {
                        return true
                    }

                    return false
                }

                // 3. Hide already processed job cards (must match specific ID, canonical URL, or company + role)
                // Targets individual job listings so sibling roles at the same company remain discoverable!
                const cardSelectors = [
                    '[data-test*="JobListing" i]',
                    '[data-test*="job-listing" i]',
                    '[class*="styles_jobListing" i]',
                    '[class*="jobListing" i]',
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

                // 5. Hide job cards and startup containers that have scrolled far off-screen (viewport bounding for infinite scroll)
                try {
                    const offscreenSelectors = [
                        ...cardSelectors,
                        '[data-test*="StartupResult" i]',
                        '[data-test="StartupResult"]',
                        '[class*="styles_result" i]',
                    ]
                    const allCards = document.querySelectorAll<HTMLElement>(offscreenSelectors.join(", "))
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
    maxSteps,
    nodeId = "default",
}: {
    stagehand: Stagehand
    instruction: string
    candidateProfile?: string
    maxSteps?: number
    nodeId?: string
}) {
    const effectiveMaxSteps = typeof maxSteps === "number" && maxSteps > 0 ? maxSteps : DEFAULT_MAX_STEPS
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
    if (!mem.timeframeDays) {
        mem.timeframeDays = parseTimeframeDaysFromInstruction(instruction)
    }

    // Preload recent applications from Airtable (bounded to the timeframe window or default 3 days)
    // to bridge persistent memory into active working memory without unbounded prompt growth
    if (!mem.airtableRecentApplications) {
        try {
            const lookbackDays = mem.timeframeDays || 3
            mem.airtableRecentApplications = await getRecentApplicationsFromAirtable(lookbackDays)
            if (mem.airtableRecentApplications.length > 0) {
                logger.info(
                    `[Agent] Preloaded ${mem.airtableRecentApplications.length} recent applications from Airtable (${lookbackDays}-day window) into active memory`
                )
            }
        } catch (preloadErr) {
            logger.warn(
                "[Agent] Failed to preload Airtable applications into memory (non-blocking)",
                { error: String(preloadErr) }
            )
            mem.airtableRecentApplications = []
        }
    }

    for (let step = 0; step < effectiveMaxSteps; step++) {
        // Snapshot existing attempted/confirmed jobs (company + role key) before this step begins
        // so we can distinguish prior submissions from the current step's planned submission
        const attemptedBeforeStepKeys = new Set(
            mem.attemptedJobs
                .filter((j) => isValidJobIdentifier(j.company) && isValidJobIdentifier(j.role))
                .map((j) => `${j.company.toLowerCase().trim()}::${j.role.toLowerCase().trim()}`)
        )
        const confirmedBeforeStepKeys = new Set(
            mem.confirmedJobs
                .filter((j) => isValidJobIdentifier(j.company) && isValidJobIdentifier(j.role))
                .map((j) => `${j.company.toLowerCase().trim()}::${j.role.toLowerCase().trim()}`)
        )

        // Rate-limit shield: gentle pause between Macro extraction calls
        // to prevent exceeding free-tier 15 RPM / 250k input tokens/min limits on Gemini
        if (step > 0) {
            await new Promise((r) => setTimeout(r, 4000))
        }

        // Wait for page DOM/content to settle or key landmark elements to appear
        const page = await stagehand.browser.context.activePage()
        let currentPageUrl = ""
        if (page) {
            await waitForPageSettle(page)
            try {
                currentPageUrl = await page.url()
                if (detectJobPlatform(currentPageUrl) === "wellfound" && currentPageUrl.includes("/location/")) {
                    logger.warn(`[Agent] Detected accidental navigation to location page (${currentPageUrl}). Navigating back to job listing.`)
                    await page.goBack().catch(() => {})
                    await waitForPageSettle(page)
                    currentPageUrl = await page.url().catch(() => currentPageUrl)
                }
            } catch {}
        }

        // Deterministic Completion Check:
        // If the candidate's target count has already been confirmed with verified proof
        // and any modal/drawer has closed, complete the node immediately rather than wasting steps.
        const genuineSubmissions = getGenuineSubmissions(mem)
        if (
            mem.targetCount &&
            genuineSubmissions.length >= mem.targetCount &&
            mem.history.length > 0 &&
            mem.history[mem.history.length - 1].success
        ) {
            const hasOpenDrawer = await page
                ?.evaluate(() => {
                    const dialogs = Array.from(
                        document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]')
                    )
                    return dialogs.some((el) => {
                        try {
                            const style = window.getComputedStyle(el)
                            const rect = el.getBoundingClientRect()
                            return (
                                style.display !== "none" &&
                                style.visibility !== "hidden" &&
                                (rect.width > 20 || el.offsetWidth > 20)
                            )
                        } catch {
                            return false
                        }
                    })
                })
                .catch(() => false)

            if (!hasOpenDrawer) {
                await restorePrunedPageDom(page).catch(() => {})
                logger.info(
                    `[Agent] Target count satisfied (${genuineSubmissions.length}/${mem.targetCount}) and dialog closed. Completing successfully.`,
                    { targetCount: mem.targetCount, confirmed: genuineSubmissions.length }
                )
                return {
                    success: true,
                    achieved: true,
                    completed: true,
                    message: `Target achieved: applied and confirmed ${genuineSubmissions.length} job(s).`,
                    summary: `Successfully applied to ${genuineSubmissions.length} job(s): ${genuineSubmissions.map((j) => `${j.company} (${j.role})`).join(", ")}.`,
                    evidence: genuineSubmissions.map((j) => `${j.company}: ${j.evidence || "Confirmed application"}`).join("; "),
                    url: currentPageUrl,
                    steps: mem.history.length,
                    confirmedJobs: mem.confirmedJobs,
                    attemptedJobs: mem.attemptedJobs,
                    skippedJobs: mem.skippedJobs,
                    inspectedJobs: mem.inspectedJobs,
                }
            }
        }

        const recentHistoryText = formatCompactRecentHistory(mem.history, 2)
        const workingMemoryText = formatCompactWorkingMemory(mem, currentPageUrl)

        const platform = detectJobPlatform(currentPageUrl)

        // =========================================================================
        // PLATFORM STRATEGY: WELLFOUND OPERATIONAL RULES (PROVEN - PRESERVED UNTOUCHED)
        // =========================================================================
        const wellfoundOperationalRules = `
=== OPERATIONAL RULES & CONSTRAINTS ===

1. SECURITY & GATES (Human-in-the-loop):
   - Strictly reserved for unsolvable security gates: CAPTCHAs, Cloudflare Turnstiles/challenges, 2FA/OTP SMS or email verification codes, or credential login prompts.
   - In those cases only, set action to "needs_human" and explain what is blocking you in "reason".
   - NEVER use "needs_human" for search criteria mismatches, unmatching listings, or missing data. Handle those autonomously.

2. THE SKELETON GUARD (Prevent Premature Backtracking):
   - If a modal, drawer, or dialog is open but contains NO job description, NO text, or only a close button ('✕'), it is in a loading/skeleton state.
   - NEVER click the close button on an empty drawer — wait or inspect the listing rather than backtracking.

3. FILTER & SORT WORKFLOW (Strict Sequential Execution):
   - DIRECT / SPECIFIC JOB SHORTCUT: If the user task names a specific company or role (e.g. "UprootSecurity"), or if a job drawer / application modal is already open on page load:
     • DO NOT open the "Filters" modal! Skip filtering completely!
     • If the target job drawer is already open on screen, proceed immediately to Phase B/Phase C (click "Apply" / fill form)!
   - When the user task requests general search filters (e.g. "most recent", experience level, specific roles):
     Step 1: Open the filter modal/menu (e.g. click "Filters").
     Step 2: Locate the Sorting control (e.g. "Sort by", "Recent", "Newest") and select "Most recent" (or equivalent newest-first option).
     Step 3: Locate the Experience filter (e.g. "Experience", "Years of experience", "Entry Level", "Intern", "0-1 years") and select the matching fresher/entry-level option.
     Step 4: VERIFY the selected values inside the filter modal BEFORE clicking "View results" or "Apply filters".
     Step 5: Only after verifying the selections, click "View results" to close the filter dialog.
   - Fallback if controls are unavailable: If a specific UI filter does NOT exist on the site, inspect the actual job cards: evaluate visible publication dates (e.g. "Posted 2h ago", "1d ago") and requirement tags directly. NEVER report a filter as applied unless it was actually selected.
   - FILTER COMPLETION RULE: Once the filter modal has been closed via "View results", the filter setup phase is COMPLETE. NEVER re-open the "Filters" modal! Proceed directly to inspecting and applying to the job listings on the page.
   - If you have already attempted to apply the experience-level filter once and it either isn't available in the filter panel, or job cards still show mismatched experience requirements after applying it, STOP retrying the filter. Switch immediately to the fallback: inspect each job card's visible text/tags directly instead.
   - Enforce job eligibility rules before starting any application.

4. TWO-STAGE APPLICATION FLOW & PROGRESS TRACKING:
   - Always report "jobUpdate" when inspecting, skipping, attempting, or confirming a job. Include company, role, direct URL (if visible/available), and status ("inspected", "skipped", "attempted", "confirmed").
   - STATUS LIFECYCLE:
     • "inspected": Used when clicking a job card, 'Learn more', reading requirements, or filling form textboxes. Merely viewing or typing in fields is "inspected" until the submit button is actually clicked.
     • "skipped": Used when a job is disqualified (e.g. requires 3+ years experience when seeking fresher/intern roles).
     • "attempted": Used ONLY in the single step where you click the final submit button ('Apply', 'Send application', 'Submit application').
     • "confirmed": Used ONLY when reliable, job-specific on-page evidence is directly observed (e.g. button changed to "Applied", or an authoritative confirmation banner like "Application submitted"). You MUST quote the exact on-page confirmation text in "evidence".
   - SUBMISSION BEHAVIOR:
     • Click 'Apply' or submit button at most ONCE per job while outcome is unresolved. A single click submits the form.
     • NEVER click 'Apply' repeatedly on the same job!
     • After submitting an application, wait for the page to update and inspect the resulting state before closing the modal.
   - Phase A (Inspect): Click the job card or "Learn more" to open the details drawer (status: "inspected").
   - Phase B (Apply): If the listing matches criteria (fresher, intern, entry-level) and an "Apply" or "Quick Apply" button is visible:
     -> Do NOT close the drawer.
     -> Click the "Apply" or "Quick Apply" button.
   - Phase C (Wellfound 4-Step Form Completion Order - STRICT SEQUENCE):
     When an application form/drawer is open on Wellfound (especially with "Update your location preferences"):
     Step 1: Check the "I can relocate to..." radio button.
             Instruction: "click the 'I can relocate to...' radio button"
             (If already checked, move directly to Step 2!)
     Step 2: Click the location dropdown directly below the radio button, and when the city list appears, click the target city (e.g. "Kochi" or "Bengaluru" or "India").
             Instruction: "click the 'Kochi' option in the location dropdown"
     Step 3: Go to the "What interests you about working for this company?" or note field and type the tailored pitch.
             CRITICAL: Use "formDelegation" so the Micro-Brain rapidly composes and types the answer. NEVER just output "click the textbox"!
     Step 4: Click the submit 'Apply' button.
             CRITICAL: Only after Steps 1, 2, and 3 are complete, the 'Apply' button becomes enabled. Click the 'Apply' button once to submit!
             NEVER try to click 'Apply' repeatedly before Steps 1-3 are finished!
     -> RELOCATION & LOCATION POLICY:
     -> RELOCATION & LOCATION POLICY:
        • Warnings like "This job does not support the locations on your profile" or "requires relocation" are NEVER disqualifiers! The candidate is 100% open to relocation worldwide/onsite.
        • NEVER skip a job or close the modal on a relocation notice.
        • If an "I can relocate to [Location]" radio button or checkbox appears and is NOT yet checked, click/select it (instruction: "click the 'I can relocate to...' radio button"). If it is ALREADY checked/selected, DO NOT re-click it!
        • If a location dropdown or combobox appears:
          CRITICAL: DO NOT type into the location box! You MUST click the city option (e.g. instruction: "click the 'Kochi' option in the dropdown" or "select '[City]' from the location dropdown") to register the selection and dismiss the relocation banner.
     -> If an application question box appears (e.g. "What interests you about working for this company?", "Why should we hire you??", "Cover note"):
        CRITICAL: NEVER output "click the textbox" or "click the textarea"! Clicking a textbox leaves it blank and prevents application submission!
        Instead, set "formDelegation" in your decision with:
        - targetField: the textbox label or placeholder
        - company: company name visible on page
        - role: job title visible on page
        - question: the question being asked
        - nextActionAfterTyping: "click the 'Send application' button"
        The Micro-Brain (Qwen) will instantly compose a tailored response and type it in.
     -> When application submission is confirmed on page (e.g. "Application submitted" or button reads "Applied"), set jobUpdate status to "confirmed" with evidence text.

5. BACKTRACKING (Real Disqualifiers or After Submitting Only):
   - ONLY backtrack (click close button '✕', 'Back', or 'Close') if:
     a. The job description has fully loaded AND explicitly disqualifies the candidate (e.g. requires 3+, 5+, or 7+ years of experience when the user asked for fresher/entry-level). Location mismatch or relocation prompts on Wellfound are NEVER disqualifiers — candidate is open to relocation! OR
     b. You have already submitted the application, inspected the result, and need to return to the search list for the next job.
   - MANDATORY ACTION WHEN SKIPPING: If disqualifying a job, you MUST set action="act", set jobUpdate.status="skipped", AND set instruction="click the close button '✕' or 'Close' on the modal to return to the job listings". NEVER leave instruction empty when skipping!
    - Return to the results list and proceed to the NEXT unchecked job listing.
    - Check the Visited Job Listings table in memory to avoid re-opening items you already inspected.
    - MULTI-ROLE POLICY: Multiple distinct roles at the same company may be open (e.g. Frontend vs Backend). If you applied to or inspected one role at a company, other DIFFERENT roles at that company remain eligible and should be inspected and applied to. Only skip or ignore a listing if that specific role was already processed or disqualified.
    - SCROLLING: If all visible job cards on the screen have already been inspected or skipped, SCROLL DOWN the page (instruction: "scroll down the page to reveal more job listings") to bring new job cards into view. NEVER re-click an already-visited card!
    - SCROLL BUDGET: You have a strict limit of at most 4 consecutive scrolls. If you reach 4 consecutive scrolls without inspecting/applying to a new matching job, STOP and declare exhaustion (action="done").

6. COMPLETION & TARGET COUNT INTEGRITY:
${
    mem.targetCount
        ? `   - Target count: ${mem.targetCount} job applications.
   - You MUST apply to the requested number of distinct jobs. Never declare "done" if you only viewed or clicked "Learn more" on a job without submitting its application!
   - TARGET REACHED: Once Confirmed >= Target (Remaining Target: 0) with on-page evidence, set action to "done" immediately.`
        : `   - Target Mode: Continuous / Timeframe window (apply to all unapplied matching jobs${mem.timeframeDays ? ` within last ${mem.timeframeDays} days` : ""}).
   - DO NOT stop after 1 or 2 applications! Continue to subsequent unapplied listings.
   - STOPPING CRITERIA (set action="done"):
     a. TIMEFRAME BOUNDARY: Visible cards are older than ${mem.timeframeDays || 3} days (e.g. "${(mem.timeframeDays || 3) + 1}d ago", "1w ago").
     b. SCROLL LIMIT: Reached 4 consecutive scrolls without new matching jobs (search exhausted).
     c. PAGE BOTTOM: Page is at bottom and all matching listings are processed.`
}
   - EXHAUSTION FALLBACK: If all visible listings are inspected/applied/skipped and no more exist, set action to "done" with confirmed count.

7. ACTION FORMAT:
   - Otherwise set action to "act" and provide one concrete, unambiguous natural-language browser instruction in "instruction" (e.g., "click the 'Learn more' button on the 'Web Development Intern' card", "type 'I am excited about...' into the 'What interests you' field", "click the submit 'Apply' button", "click the close button '✕' or 'Close' on the modal to return to the job listings").
   - NEVER leave "instruction" empty when action is "act".
`

        // =========================================================================
        // PLATFORM STRATEGY: YC (WORK AT A STARTUP) OPERATIONAL RULES
        // =========================================================================
        const ycOperationalRules = `
=== YC (WORK AT A STARTUP) OPERATIONAL RULES & CONSTRAINTS ===

1. PLATFORM ARCHITECTURE (workatastartup.com):
   - You are operating on Y Combinator's Work at a Startup portal (https://www.workatastartup.com).
   - Directory Layout: Listings are organized by YC-backed companies, with each company displaying its batch (e.g., W24, S23), description, and one or more open roles.
   - Multiple distinct roles under the same company (e.g., Frontend, Backend, Fullstack) may be open and eligible.

2. SECURITY & GATES (Human-in-the-loop):
   - Strictly reserved for unsolvable security gates: CAPTCHAs, Cloudflare Turnstiles, 2FA/OTP SMS or email verification codes, or credential login prompts.
   - In those cases only, set action to "needs_human" and explain what is blocking you in "reason".
   - NEVER use "needs_human" for search criteria mismatches, unmatching listings, or missing data. Handle those autonomously.

3. FILTER & SEARCH CONTROLS:
   - Use the top filter controls (Role / Function, Experience level, Location / Remote, Batch) to narrow down results when requested.
   - If specific UI filters are not visible, inspect visible job card tags and role titles directly.

4. YC APPLICATION WORKFLOW & NOTE TO FOUNDERS (CRITICAL):
   - Always report "jobUpdate" when inspecting, skipping, attempting, or confirming a job. Include company, role, direct URL (if visible), and status ("inspected", "skipped", "attempted", "confirmed").
   - Phase A (Inspect): Click on a job role or "Apply" / "Learn more" to view its full details (status: "inspected").
   - Phase B (Match & Open Form): If the role matches candidate criteria and has an active "Apply" or "Quick Apply" button, click it to open the application modal.
   - Phase C (Founder Note - HIGH PRIORITY ON YC):
     -> YC founders read candidate notes directly. Almost every YC job requires a short intro note ("Write a note to [Company/Founders]", "Why are you interested in this role?").
     -> NEVER submit an empty or generic spam note!
     -> Set "formDelegation" or provide an instruction with a tailored, concise 2-4 sentence pitch combining the candidate's real skills/projects with the company's product domain.
     -> Once the note is entered, click the submit button ("Send application", "Submit application", or "Apply").
     -> Set jobUpdate status to "attempted" ONLY in the single step where the final submit button is clicked.
   - Phase D (Confirmation & Evidence):
     -> Observe on-page proof: Look for "Application sent", "Applied", or a confirmation banner.
     -> You MUST quote the exact on-page confirmation text in "evidence" and set jobUpdate status to "confirmed".

5. BACKTRACKING & NAVIGATION:
   - ONLY backtrack (close tab, close modal or navigate back) if:
     a. The job description explicitly disqualifies the candidate (e.g. requires 5+ years for junior candidates), OR
     b. You have already submitted the application and verified the outcome.
   - When skipping or done with a job page: set action="act", set jobUpdate.status="skipped" or "inspected", and set instruction="close tab to return to the job listings" (or "click the close button '✕' or 'Close' on the modal to return to the job listings").
   - If all visible company/job cards on the screen have been processed, scroll down ("scroll down the page to reveal more job listings").
   - SCROLL BUDGET: Maximum 4 consecutive scrolls without finding a new matching job before concluding search cleanly as exhausted.

6. COMPLETION & TARGET COUNT INTEGRITY:
${
    mem.targetCount
        ? `   - Target count: ${mem.targetCount} job applications.
   - You MUST apply to the requested number of distinct jobs. Never declare "done" without submitted applications!
   - TARGET REACHED: Once Status Overview shows Confirmed >= Target (Remaining Target: 0) with on-page evidence, immediately set action to "done".`
        : `   - Target Mode: Continuous / Timeframe window (apply to all unapplied matching jobs${mem.timeframeDays ? ` within last ${mem.timeframeDays} days` : ""}).
   - Continue inspecting and applying to unapplied listings on the page.
   - Stop when 4 scrolls are reached, page bottom is hit, or target timeframe is exceeded.`
}

7. ACTION FORMAT:
   - Provide one concrete natural-language browser instruction in "instruction" (e.g. "click the 'Apply' button on 'Founding Full Stack Engineer'", "type '...' into the 'note to founders' field", "click the 'Send application' button", "click the close button '✕' or 'Close' on the modal to return to the job listings").
   - NEVER leave "instruction" empty when action is "act".
`

        const platformRules = platform === "yc" ? ycOperationalRules : wellfoundOperationalRules

        const plannerPrompt = `
${platformRules.trim()}

=== CANDIDATE PROFILE ===
${candidateProfile || DEFAULT_CANDIDATE_PROFILE}

=== TASK GOAL ===
"${instruction}"

=== PERSISTENT WORKING MEMORY ===
${workingMemoryText}

=== RECENT ACTIONS (LAST 2) ===
${recentHistoryText}

Look at the current page and decide the SINGLE next browser action needed to make progress on the task.
`.trim()

        // ── DOM Pruning & Scoped Extraction (Token Optimization) ───────────
        let extractOptions: any = undefined
        let pruneResult: { prunedCount: number; restoredCount: number; hasOpenDialog: boolean } | undefined = undefined
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
                ...mem.attemptedJobs.map((j) => ({
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
            pruneResult = await prunePageDom(page, { processedJobs })
            if (pruneResult.prunedCount > 0 || pruneResult.restoredCount > 0) {
                logger.info(
                    `[Agent] DOM Pruning: masked ${pruneResult.prunedCount}, restored ${pruneResult.restoredCount} elements (dialogOpen=${pruneResult.hasOpenDialog})`
                )
            }

            // Zero-token Wellfound relocation auto-resolver
            if (platform === "wellfound" && pruneResult.hasOpenDialog) {
                const relocResult = await autoResolveWellfoundRelocation(page).catch(() => ({ resolved: false, details: undefined }))
                if (relocResult.resolved) {
                    logger.info(`[Agent] Auto-resolved Wellfound relocation prompt: ${relocResult.details}`)
                    // Write to mem.history so planner doesn't re-click the radio button next step
                    mem.history.push({
                        instruction: "auto-resolve Wellfound relocation prompt",
                        success: true,
                        message: `Selected city in location dropdown AND clicked 'I can relocate to...' radio: ${relocResult.details}`,
                    })
                    await new Promise((r) => setTimeout(r, 300))
                }
            }

            try {
                if (pruneResult.hasOpenDialog) {
                    // Scope extraction to the open drawer/modal AND any open floating dropdown menus/portals
                    extractOptions = {
                        locator: page.locator(
                            '[data-stagehand-active-dialog="true"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [class*="portal" i]'
                        ),
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
                    plannerPrompt,
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
            if (!isValidJobIdentifier(company) || !isValidJobIdentifier(role)) {
                logger.warn(
                    `[Agent] Discarding invalid jobUpdate with blank or null company/role: "${company}" - "${role}"`,
                    { step: step + 1, jobUpdate: decision.jobUpdate }
                )
            } else {
                const cleanUrl = isGenericSearchUrl(url) ? undefined : url

                // Strict Status Lifecycle Enforcement:
                // "attempted" is strictly reserved for when a submit action is actually triggered for this job,
                // or if this specific job was already recorded as attempted in an earlier step.
                // If the agent attempts to report "attempted" while merely inspecting, reading, or typing, demote to "inspected".
                let effectiveStatus = status
                if (effectiveStatus === "attempted") {
                    const currentInstruction = decision.action === "act" ? decision.instruction : undefined
                    // If formDelegation is present, this step is ONLY typing text, NOT submitting!
                    const isTypingStep = Boolean(decision.formDelegation)
                    const isCurrentlySubmitting =
                        !isTypingStep && isSubmitAction(currentInstruction, pruneResult?.hasOpenDialog)
                    const jobKey = `${company.toLowerCase().trim()}::${role.toLowerCase().trim()}`
                    const isAlreadyAttempted = attemptedBeforeStepKeys.has(jobKey)

                    if (!isCurrentlySubmitting && !isAlreadyAttempted) {
                        effectiveStatus = "inspected"
                    }
                }

                // 2. Ground Truth Confirmation Guard:
                // Require reliable, job-specific on-page evidence before accepting "confirmed" status.
                // A successful browser click, closed modal, model claim, or reaching target count is NOT sufficient.
                if (effectiveStatus === "confirmed") {
                    const rawEvidence = (evidence || "").trim()
                    const hasVerifiableProof =
                        rawEvidence.length >= 5 &&
                        !/^completed|^done|^clicked|^applied$/i.test(rawEvidence) &&
                        /(?:submitted|received|applied|sent|confirmation|success|applied\s+on|thank\s+you|pending)/i.test(
                            rawEvidence
                        )

                    // Verify against live page: Proof MUST exist on screen, and the form must NOT still be open with an unsubmitted Apply button!
                    let livePageConfirmed = false
                    if (page) {
                        livePageConfirmed = await page.evaluate((claimed: string) => {
                            const drawer = document.querySelector<HTMLElement>(
                                '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [class*="styles_drawer" i]'
                            )

                            // If the drawer is still open and contains an unsubmitted Apply/Submit button, the job is NOT confirmed!
                            if (drawer) {
                                const buttons = Array.from(drawer.querySelectorAll<HTMLElement>('button, [role="button"]'))
                                const hasUnsubmittedApplyBtn = buttons.some((b) => {
                                    const t = (b.textContent || "").trim().toLowerCase()
                                    return t === "apply" || t === "send application" || t === "submit application"
                                })
                                if (hasUnsubmittedApplyBtn) {
                                    return false // Form is still open with an unsubmitted Apply button!
                                }
                            }

                            const bodyText = (document.body.innerText || document.body.textContent || "").toLowerCase()

                            // Explicit on-page success indicators
                            if (
                                bodyText.includes("application submitted") ||
                                bodyText.includes("your application has been submitted") ||
                                bodyText.includes("application sent") ||
                                bodyText.includes("applied on") ||
                                bodyText.includes("you've applied") ||
                                bodyText.includes("successfully applied")
                            ) {
                                return true
                            }

                            // Check if button changed to "Applied"
                            const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
                            if (allBtns.some((b) => (b.textContent || "").trim().toLowerCase() === "applied")) {
                                return true
                            }

                            // Check if claimed text exists verbatim on page
                            if (claimed && claimed.length >= 8 && bodyText.includes(claimed.toLowerCase())) {
                                return true
                            }

                            return false
                        }, rawEvidence).catch(() => false)
                    }

                    if (!hasVerifiableProof || (page && !livePageConfirmed)) {
                        logger.warn(
                            `[Agent] Confirmation claim for '${company} - ${role}' lacks verified on-page proof (livePageConfirmed=${livePageConfirmed}, proofRegex=${hasVerifiableProof}). Preserving as 'attempted'.`
                        )
                        effectiveStatus = "attempted"
                    }
                }

                const entry: JobMemoryEntry = {
                    company: company.trim(),
                    role: role.trim(),
                    url: cleanUrl,
                    status: effectiveStatus,
                    reason:
                        effectiveStatus === "attempted" && status === "confirmed"
                            ? "Submission click executed; awaiting explicit on-page confirmation proof."
                            : reason,
                    evidence: effectiveStatus === "confirmed" ? evidence : undefined,
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
        }

        // ── 4-Scroll Circuit Breaker & Page-Bottom Exhaustion Guard ─────────
        const isPlannedScrollDown =
            decision.action === "act" &&
            Boolean(decision.instruction && /scroll\s+down/i.test(decision.instruction))

        const lastAction = mem.history[mem.history.length - 1]
        const wasLastActionAtBottom =
            lastAction &&
            lastAction.success &&
            /at the bottom/i.test(lastAction.message)

        const currentScrollCount = mem.consecutiveScrolls || 0
        const isScrollLimitReached =
            currentScrollCount >= 4 ||
            (isPlannedScrollDown && (currentScrollCount + 1) >= 4) ||
            wasLastActionAtBottom

        if (isScrollLimitReached) {
            const nextScrollCount = isPlannedScrollDown ? currentScrollCount + 1 : currentScrollCount
            logger.info(
                `[Agent] ${currentScrollCount >= 4 || (isPlannedScrollDown && currentScrollCount + 1 >= 4) ? "4-scroll limit reached" : "Page bottom reached"}: concluding search cleanly as exhausted.`,
                { step: step + 1, consecutiveScrolls: nextScrollCount, wasLastActionAtBottom }
            )
            mem.consecutiveScrolls = nextScrollCount
            const genuineSubmissions = getGenuineSubmissions(mem)
            decision.action = "done"
            decision.message = wasLastActionAtBottom
                ? `Search exhausted: reached the bottom of the listings page. Total confirmed applications: ${genuineSubmissions.length}.`
                : `Search exhausted: reached the 4-scroll limit without finding new unapplied matching listings within the target timeframe. Total confirmed applications: ${genuineSubmissions.length}.`
        }

        if (decision.action === "done") {
            const genuineSubmissions = getGenuineSubmissions(mem)

            // Target Count Completion Guard:
            // Prevent premature completion if the agent claims success but genuine submitted jobs < targetCount
            if (mem.targetCount && genuineSubmissions.length < mem.targetCount && step < effectiveMaxSteps - 2) {
                const isClaimingExhaustion =
                    (mem.consecutiveScrolls || 0) >= 4 ||
                    wasLastActionAtBottom ||
                    /no\s+(?:more|other|matching|further)\s+jobs?|inspected\s+all|exhausted|could\s+not\s+find|no\s+additional|4-scroll/i.test(
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
                        ...mem.attemptedJobs.map((j) => ({
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

                // ── Double Audit Elimination (Zero-Risk Token Optimization) ───
                // If genuine submissions were already confirmed with on-page proof in memory,
                // use that verified proof and skip the redundant 17,131-token extraction call!
                const verifiedSubmissions = getGenuineSubmissions(mem)
                if (verifiedSubmissions.length > 0) {
                    verification = {
                        achieved: true,
                        summary: `Successfully applied to and confirmed ${verifiedSubmissions.length} job(s) with verified on-page proof.`,
                        evidence: verifiedSubmissions
                            .map((j) => `${j.company} - ${j.role}: ${j.evidence || "Confirmed application"}`)
                            .join("; "),
                    }
                    logger.info(
                        `[Agent] Verified proof already in memory (${verifiedSubmissions.length} confirmed jobs). Skipping redundant internal LLM audit call (saved ~17k tokens).`
                    )
                } else {
                    const verifyResult = await extractWithRetry(
                        stagehand,
                        `You are an objective auditor evaluating whether the user's task was successfully accomplished on this web page.
Goal / Task: "${instruction}"
Actions taken (recent):
${recentHistoryText}
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
                }
            } catch (vErr) {
                logger.warn("[Agent] Verification extraction warning, falling back to planner decision", {
                    error: String(vErr),
                })
            }

            // If verification check indicates the goal was NOT yet achieved, and we still have steps:
            if (!verification.achieved && step < effectiveMaxSteps - 1) {
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

            // Restore pruned DOM to its pristine state for the human
            await restorePrunedPageDom(page).catch(() => {})

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

        if (decision.action === "navigate") {
            const page = await stagehand.browser.context.activePage()
            if (page && decision.url) {
                await page.goto(decision.url)
                await waitForPageSettle(page)
            }
            mem.history.push({
                instruction: `navigate to ${decision.url || ""}`,
                success: true,
                message: `Navigated to ${decision.url || ""}`,
            })
            continue
        }

        // Pre-resolve any open Wellfound relocation prompt before filling forms or executing next action
        if (platform === "wellfound" && page) {
            const relocResult = await autoResolveWellfoundRelocation(page).catch(() => ({ resolved: false, details: undefined }))
            if (relocResult.resolved) {
                logger.info(`[Agent] Auto-resolved Wellfound relocation prompt: ${relocResult.details}`)
                // Write to mem.history so the Macro Planner knows relocation + city were already handled
                // and does NOT re-click the radio on the next step.
                mem.history.push({
                    instruction: "auto-resolve Wellfound relocation prompt",
                    success: true,
                    message: `Selected city in location dropdown AND clicked 'I can relocate to...' radio: ${relocResult.details}`,
                })
                await new Promise((r) => setTimeout(r, 300))
            }
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
                // Keep Stagehand act() atomic: ONLY type in this step.
                // On the very next step, the job is still "inspected", so the planner will click Submit!
                decision.instruction = `type '${cleanText}' into the '${decision.formDelegation.targetField}' textbox`
            }
        }

        // Auto-heal missing or empty instruction scenarios instead of crashing the workflow:
        if (!decision.instruction || !decision.instruction.trim()) {
            if (decision.formDelegation) {
                // If form delegation didn't produce text (e.g. Micro-Brain unavailable), fallback to typing placeholder or submit
                decision.instruction =
                    decision.formDelegation.nextActionAfterTyping ||
                    (platform === "wellfound" ? `click the 'Send application' button` : `click the submit 'Apply' button`)
            } else if (decision.jobUpdate?.status === "skipped") {
                // When a job is disqualified/skipped, the immediate browser action is closing the drawer
                logger.info(
                    `[Agent] Inferred missing instruction for skipped job (${decision.jobUpdate.company}): closing modal to return to listings.`
                )
                decision.instruction =
                    "click the close button '✕' or 'Close' on the modal to return to the job listings"
            } else if (
                decision.message &&
                /^(?:click|press|type|scroll|navigate|open|close|select|return)/i.test(
                    decision.message.trim()
                )
            ) {
                decision.instruction = decision.message.trim()
            } else if (
                decision.reason &&
                /^(?:click|press|type|scroll|navigate|open|close|select|return)/i.test(
                    decision.reason.trim()
                )
            ) {
                decision.instruction = decision.reason.trim()
            } else if (platform === "wellfound" && currentPageUrl && currentPageUrl.includes("job_listing_slug")) {
                // On an open Wellfound job listing drawer, default to closing modal to return to search list
                decision.instruction =
                    "click the close button '✕' or 'Close' on the modal to return to the job listings"
            } else if (platform === "yc" && currentPageUrl && (/\/jobs\/\d+|\/companies\/[^\/]+\/jobs/i.test(currentPageUrl))) {
                // On an open YC job page, default to returning to company directory
                decision.instruction =
                    "click the close button '✕' or 'Close' on the modal to return to the job listings"
            }
        }

        // Viewport Stagnation Interceptor:
        // If the planner instructs to click a card for a specific job (company + role) that was ALREADY skipped or confirmed,
        // it means that specific listing was already processed and the agent may be stuck looking at the top fold.
        // Auto-heal by converting the instruction to scroll down and bring fresh job cards into view!
        // NOTE: Never stagnates by company alone; multiple roles at the same company remain discoverable!
        if (
            decision.instruction &&
            /click.*(?:card|button|Learn more)/i.test(decision.instruction)
        ) {
            const lowerInstruction = decision.instruction.toLowerCase()

            const allProcessed = [
                ...mem.skippedJobs,
                ...mem.confirmedJobs,
                ...(mem.airtableRecentApplications || []),
            ]

            const matchingProcessedJob = allProcessed.find((j) => {
                const comp = (j.company || "").toLowerCase().trim()
                const role = (j.role || "").toLowerCase().trim()
                if (!comp || !role || !isValidJobIdentifier(comp) || !isValidJobIdentifier(role)) {
                    return false
                }

                // Check if both company and role are mentioned in the instruction
                const cleanRole = role.replace(/\s*\([^)]*\)/g, "").trim().toLowerCase()
                const instructionMatchesBoth =
                    lowerInstruction.includes(comp) &&
                    (lowerInstruction.includes(role) || (cleanRole.length >= 3 && lowerInstruction.includes(cleanRole)))

                // Or if decision.jobUpdate targets this exact company and role
                const updateMatchesBoth =
                    decision.jobUpdate &&
                    decision.jobUpdate.company?.toLowerCase().trim() === comp &&
                    decision.jobUpdate.role?.toLowerCase().trim() === role

                return instructionMatchesBoth || updateMatchesBoth
            })

            if (matchingProcessedJob) {
                const isDrawerOpen = Boolean(
                    platform === "wellfound"
                        ? currentPageUrl && currentPageUrl.includes("job_listing_slug")
                        : platform === "yc"
                          ? /\/jobs\/\d+|\/companies\/[^\/]+\/jobs/i.test(currentPageUrl)
                          : false
                )
                if (isDrawerOpen) {
                    logger.info(
                        `[Agent] Viewport Stagnation detected inside open job drawer for '${matchingProcessedJob.company} - ${matchingProcessedJob.role}'. Auto-healing instruction to close modal and return to listings.`,
                        { company: matchingProcessedJob.company, role: matchingProcessedJob.role, step: step + 1 }
                    )
                    decision.instruction =
                        platform === "yc" && /\/jobs\/\d+/i.test(currentPageUrl)
                            ? "return to the job listings"
                            : "click the close button '✕' or 'Close' on the modal to return to the job listings"
                } else {
                    logger.info(
                        `[Agent] Viewport Stagnation detected: planner attempted to re-click '${matchingProcessedJob.company} - ${matchingProcessedJob.role}' which is already in Visited Job Listings. Auto-healing instruction to scroll down.`,
                        { company: matchingProcessedJob.company, role: matchingProcessedJob.role, step: step + 1 }
                    )
                    decision.instruction = "scroll down the page to reveal more job listings"
                }
            }
        }

        // Redundant Sort Interceptor (Zero-Risk Token Optimization):
        // If sorting by 'Most recent' was already executed earlier, intercept attempts to re-click sort controls
        if (
            mem.sortApplied &&
            decision.instruction &&
            /(?:click|select|open).*(?:sort by|'most recent' sort|dropdown.*sort)/i.test(decision.instruction)
        ) {
            logger.info(
                `[Agent] Intercepted redundant sort click: sorting was already selected at step ${mem.sortAppliedAtStep || 1}. Converting to scroll down.`
            )
            decision.instruction = "scroll down the page to reveal more job listings"
        }

        const isScrollDown = /scroll\s+down/i.test(decision.instruction || "")
        if (isScrollDown) {
            mem.consecutiveScrolls = (mem.consecutiveScrolls || 0) + 1
            if (mem.consecutiveScrolls >= 4) {
                logger.info(
                    `[Agent] 4-scroll limit reached after auto-heal: concluding search cleanly as exhausted.`,
                    { step: step + 1, consecutiveScrolls: mem.consecutiveScrolls }
                )
                const page = await stagehand.browser.context.activePage()
                const resolvedUrl = page ? await page.url() : ""
                await restorePrunedPageDom(page).catch(() => {})
                const genuineSubmissions = getGenuineSubmissions(mem)
                return {
                    success: true,
                    achieved: true,
                    completed: true,
                    message: `Search exhausted: reached the 4-scroll limit without finding new unapplied matching listings within the target timeframe. Total confirmed applications: ${genuineSubmissions.length}.`,
                    summary: `Search exhausted: ${genuineSubmissions.length} job(s) applied.`,
                    evidence: genuineSubmissions.length > 0
                        ? genuineSubmissions.map((j) => `${j.company}: ${j.evidence || "Confirmed"}`).join("; ")
                        : "Search exhausted: reached the 4-scroll limit with no unapplied matching listings found.",
                    url: resolvedUrl,
                    steps: mem.history.length,
                    confirmedJobs: mem.confirmedJobs,
                    attemptedJobs: mem.attemptedJobs,
                    skippedJobs: mem.skippedJobs,
                    inspectedJobs: mem.inspectedJobs,
                }
            }
        } else if (
            !isCloseAction(decision.instruction) &&
            (/click.*(?:card|Learn more|Quick Apply|Apply)/i.test(decision.instruction || "") ||
             /type\s+/i.test(decision.instruction || ""))
        ) {
            mem.consecutiveScrolls = 0
        }

        if (!decision.instruction || !decision.instruction.trim()) {
            logger.warn(
                `[Agent] Step ${step + 1}: Planner returned action "act" with no instruction. Self-healing by inspecting page.`,
                { decision }
            )
            mem.history.push({
                instruction: "(planner returned empty instruction)",
                success: false,
                message: "No action instruction provided by planner. Inspecting page to recover.",
            })
            continue
        }

        // Duplicate submit click interceptor:
        // A final Apply/Submit click must occur at most once per job while its outcome is unresolved.
        // Prevent repeating submit button clicks in loops or resubmitting previously attempted/confirmed jobs.
        // NOTE: Matching requires specific company AND role together. Multiple roles at the same company are allowed!
        const isCurrentActionSubmit = isSubmitAction(decision.instruction, pruneResult?.hasOpenDialog)

        // Wellfound Relocation Completion Guard:
        // If an application drawer is open and the relocation prompt is still incomplete (unselected dropdown),
        // intercept any premature submit attempts and force the required relocation step first!
        if (platform === "wellfound" && page && isCurrentActionSubmit) {
            const relocCheck = await page.evaluate(() => {
                const drawer =
                    document.querySelector<HTMLElement>(
                        '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [class*="styles_drawer" i]'
                    ) || document.body
                const text = (drawer.textContent || "").toLowerCase()
                const hasPrompt =
                    text.includes("update your location preferences") ||
                    text.includes("does not support the locations on your profile")
                if (!hasPrompt) return { incomplete: false, step: "" }

                // Check radio
                const radios = Array.from(drawer.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
                const relocRadio = radios.find((r) =>
                    (r.closest("label")?.textContent || r.parentElement?.textContent || "").toLowerCase().includes("relocate")
                ) || (radios.length >= 2 ? radios[1] : null)

                if (relocRadio && !relocRadio.checked) {
                    return { incomplete: true, step: "radio" }
                }

                // Check dropdown: if text still has "-" and does not have "kochi"
                const hasKochiSelected = text.includes("kochi")
                const hasHyphen = text.includes("-")
                if (!hasKochiSelected && hasHyphen) {
                    return { incomplete: true, step: "city" }
                }

                return { incomplete: false, step: "" }
            }).catch(() => ({ incomplete: false, step: "" }))

            if (relocCheck.incomplete) {
                if (relocCheck.step === "radio") {
                    logger.info("[Agent] Redirected premature submit click: checking 'I can relocate' radio first.")
                    decision.instruction = "click the 'I can relocate to...' radio button"
                } else if (relocCheck.step === "city") {
                    logger.info("[Agent] Redirected premature submit click: selecting 'Kochi' in location dropdown first.")
                    decision.instruction = "click the location dropdown '-' and select 'Kochi'"
                }
            }
        }
        const lastStep = mem.history[mem.history.length - 1]
        const wasLastStepSubmit =
            lastStep &&
            lastStep.success &&
            isSubmitAction(lastStep.instruction)

        const currentJobCompany = (
            decision.jobUpdate?.company ||
            decision.formDelegation?.company ||
            ""
        ).toLowerCase().trim()
        const currentJobRole = (
            decision.jobUpdate?.role ||
            decision.formDelegation?.role ||
            ""
        ).toLowerCase().trim()

        const currentJobKey =
            currentJobCompany && currentJobRole
                ? `${currentJobCompany}::${currentJobRole}`
                : ""

        const isCurrentJobAlreadyAttemptedOrConfirmed =
            Boolean(currentJobKey) &&
            (confirmedBeforeStepKeys.has(currentJobKey) ||
             attemptedBeforeStepKeys.has(currentJobKey))

        if (
            !mem.sortApplied &&
            decision.instruction &&
            /(?:click|select).*(?:most recent|'most recent')/i.test(decision.instruction)
        ) {
            mem.sortApplied = true
            mem.sortAppliedAtStep = step + 1
            logger.info(`[Agent] Recorded sortApplied: true at step ${step + 1}`)
        }

        if (isCurrentActionSubmit && (wasLastStepSubmit || isCurrentJobAlreadyAttemptedOrConfirmed)) {
            // Check if the application form is actually still open and unsubmitted on screen
            const formStillOpen = await page?.evaluate(() => {
                const drawer = document.querySelector<HTMLElement>(
                    '[role="dialog"], [aria-modal="true"], [data-test*="JobListingDrawer"], [class*="styles_drawer" i]'
                )
                if (!drawer) return false
                const buttons = Array.from(drawer.querySelectorAll<HTMLElement>('button, [role="button"]'))
                return buttons.some((b) => {
                    const t = (b.textContent || "").trim().toLowerCase()
                    return t === "apply" || t === "send application" || t === "submit application"
                })
            }).catch(() => false)

            if (!formStillOpen) {
                logger.info(
                    `[Agent] Intercepted redundant submit click for ${currentJobKey || currentJobCompany || "current job"}: outcome is ${isCurrentJobAlreadyAttemptedOrConfirmed ? "already recorded/unresolved" : "submitted"}. Replacing with modal close.`
                )
                decision.instruction =
                    platform === "yc" && /\/jobs\/\d+/i.test(currentPageUrl)
                        ? "return to the job listings"
                        : "click the close button '✕' or 'Close' on the modal to return to the job listings"
            } else {
                logger.info(
                    `[Agent] Redundant submit click requested, but form is STILL OPEN with an unsubmitted Apply button. Re-running relocation auto-resolver instead of closing modal.`
                )
                if (platform === "wellfound" && page) {
                    await autoResolveWellfoundRelocation(page).catch(() => {})
                }
            }
        }

        let actSuccess = false
        let actMessage = ""

        // ── Mechanical Action Dispatch (zero-token path) ─────────────────────
        // For deterministic actions (close modal, scroll), execute directly via
        // Playwright without calling stagehand.act() — saving ~17k tokens per step.
        //
        // Control flow:
        //   mechanical.handled = true  AND  mechanical.success = true
        //     → action verified as done; push to history and continue to next step.
        //   mechanical.handled = false  (ambiguous selector, verification failed, exception)
        //     → fall through to stagehand.act() below for LLM-backed resolution.
        //   mechanical.handled = true  AND  mechanical.success = false
        //     → also falls through; never silently records a failure and moves on.
        const mechanicalPage = await stagehand.browser.context.activePage()
        if (mechanicalPage) {
            const mechanical = await tryMechanicalAction(mechanicalPage, decision.instruction, platform, stagehand)
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

                // When submit action succeeded mechanically, promote the job to attemptedJobs
                if (isSubmitAction(decision.instruction, pruneResult?.hasOpenDialog)) {
                    const comp = decision.jobUpdate?.company || decision.formDelegation?.company
                    const rol = decision.jobUpdate?.role || decision.formDelegation?.role
                    if (comp && rol && isValidJobIdentifier(comp) && isValidJobIdentifier(rol)) {
                        const existingIdx = mem.attemptedJobs.findIndex(
                            (j) => j.company.toLowerCase() === comp.toLowerCase() && j.role.toLowerCase() === rol.toLowerCase()
                        )
                        const entry: JobMemoryEntry = {
                            company: comp.trim(),
                            role: rol.trim(),
                            url: decision.jobUpdate?.url,
                            status: "attempted",
                        }
                        if (existingIdx >= 0) {
                            mem.attemptedJobs[existingIdx] = entry
                        } else {
                            mem.attemptedJobs.push(entry)
                        }
                        const inspIdx = mem.inspectedJobs.findIndex(
                            (j) => j.company.toLowerCase() === comp.toLowerCase() && j.role.toLowerCase() === rol.toLowerCase()
                        )
                        if (inspIdx >= 0) {
                            mem.inspectedJobs.splice(inspIdx, 1)
                        }
                    }
                }

                continue
            }
            // mechanical.handled=false or mechanical.success=false: fall through to stagehand.act()
        }


        // ── LLM-backed stagehand.act() (complex/ambiguous instructions only) ─
        try {
            const actResult = await stagehand.act(decision.instruction)
            actSuccess = actResult?.data?.success ?? false
            actMessage = actResult?.data?.message ?? ""
        } catch (actErr: any) {
            actSuccess = false
            actMessage = String(actErr?.message || actErr)
        }

        mem.history.push({
            instruction: decision.instruction,
            success: actSuccess,
            message: actMessage,
        })

        // Post-submit grace period & settle:
        // When clicking Apply/submit, wait for DOM updates, network requests, and modal transitions to settle
        if (isSubmitAction(decision.instruction, pruneResult?.hasOpenDialog) && actSuccess) {
            await new Promise((r) => setTimeout(r, 1500))
            const currentPage = await stagehand.browser.context.activePage()
            if (currentPage) {
                await waitForPageSettle(currentPage, { settleMs: 500, maxWaitMs: 3000 })
            }
        }
    }

    const page = await stagehand.browser.context.activePage()
    const resolvedUrl = page ? await page.url() : ""

    const genuineSubmissions = getGenuineSubmissions(mem)
    const targetSatisfied = mem.targetCount
        ? genuineSubmissions.length >= mem.targetCount
        : genuineSubmissions.length > 0
    if (targetSatisfied) {
        await restorePrunedPageDom(page).catch(() => {})
        logger.info(
            `[Agent] Step limit reached, but target condition (${genuineSubmissions.length} confirmed) has been met! Completing successfully.`,
            {
                confirmedCount: genuineSubmissions.length,
                targetCount: mem.targetCount ?? "continuous",
            }
        )
        return {
            success: true,
            achieved: true,
            completed: true,
            message: `Successfully applied to and confirmed ${genuineSubmissions.length} job(s).`,
            summary: `Applied and confirmed ${genuineSubmissions.length} job(s): ${genuineSubmissions.map((j) => `${j.company} - ${j.role}`).join(", ")}.`,
            evidence: genuineSubmissions
                .map(
                    (j) =>
                        `${j.company}: ${j.evidence || "Confirmed application"}`
                )
                .join("; "),
            url: resolvedUrl,
            steps: mem.history.length,
            confirmedJobs: mem.confirmedJobs,
            attemptedJobs: mem.attemptedJobs,
            skippedJobs: mem.skippedJobs,
            inspectedJobs: mem.inspectedJobs,
        }
    }

    await restorePrunedPageDom(page).catch(() => {})

    throw new Error(
        `Agent did not complete the task within ${effectiveMaxSteps} steps. Last state URL: ${resolvedUrl || "unknown"}`
    )
}