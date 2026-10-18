import toposort from "toposort"
import { logger, metadata, task } from "@trigger.dev/sdk"
import { browserbase, Stagehand } from "@browserbasehq/stagehand"
import type { BrowserContext as PlaywrightContext } from "playwright"

import { nodeExecutors } from "@/features/workflows/nodes/node-executors"
import { getWorkflow } from "@/features/workflows/data"
import { listConnectedAccounts } from "@/features/accounts/data"
import { interpolate } from "@/features/workflows/lib/interpolate"
import { nodeRegistry, type NodeType } from "@/features/workflows/nodes/node-registry"

export type RunStep = {
    id: string
    nodeId: string
    nodeType: string
    type?: string
    title: string
    status: "pending" | "running" | "done" | "failed"
    startedAt?: string
    completedAt?: string
    finishedAt?: string
    durationMs?: number
    output?: unknown
    error?: string
    errorStack?: string
}

export type GoalEvaluationStatus =
    | "achieved"
    | "not_achieved"
    | "unverified"
    | "blocked"
    | "failed"
    | "unfulfilled"

export type GoalEvaluation = {
    achieved: boolean
    status: GoalEvaluationStatus
    goal?: string
    summary?: string
    evidence?: string
}

export type RunWorkflowOutput = {
    steps: RunStep[]
    sessionId?: string
    goalEvaluation?: GoalEvaluation
    summary?: Record<string, unknown>
}

import { buildWorkflowSummary } from "./workflow-summary.ts"
export { buildWorkflowSummary }

// How many times to retry a single step before giving up. The step
// is re-executed in-place; prior step outputs and the Browserbase
// session are preserved across retries.
const STEP_MAX_ATTEMPTS = 3
const STEP_RETRY_MIN_TIMEOUT_MS = 1_000
const STEP_RETRY_MAX_TIMEOUT_MS = 10_000

export const runWorkflowTask = task({
    id: "run-workflow",

    run: async (
        {
            workflowId,
            orgId,
        }: {
            workflowId: string
            orgId: string
        },
        { ctx }
    ) => {
        const runId = ctx?.run?.id ?? `local_${Date.now()}`
        const workflowStartTime = Date.now()
        let workflowError: unknown = null
        let airtableSyncResult: any = null
        let goalEvaluation: GoalEvaluation | undefined

        const workflow = await getWorkflow(orgId, workflowId)

        if (!workflow?.graph) {
            throw new Error(`Workflow ${workflowId} has no graph`)
        }

        const { nodes, edges } = workflow.graph

        const byId = new Map(nodes.map((n) => [n.id, n]))

        // Only run nodes that are connected by an edge.
        const connected = new Set(
            edges.flatMap((e) => [e.source, e.target])
        )

        const order = toposort
            .array(
                nodes.map((n) => n.id),
                edges.map((e) => [e.source, e.target])
            )
            .filter((id) => connected.has(id))

        logger.log(`Running workflow ${workflow.name}`, {
            steps: order.length,
        })

        let steps: RunStep[] = order.map((id) => {
            const node = byId.get(id)
            const nodeType = (node?.data?.type ?? "unknown") as string
            const title =
                node?.data?.title ??
                (nodeType in nodeRegistry
                    ? nodeRegistry[nodeType as NodeType].label
                    : nodeType)
            return {
                id,
                nodeId: id,
                nodeType,
                type: nodeType,
                title,
                status: "pending",
            }
        })

        metadata.set("steps", steps as any)
        await metadata.flush()

        let browser: Awaited<ReturnType<typeof browserbase.launch>> | undefined
        let stagehand: Stagehand | undefined
        let sessionId: string | undefined
        let localPlaywrightContext: PlaywrightContext | undefined
        let localRecordingsDir: string | undefined

        const getStagehand = async (): Promise<Stagehand> => {
            if (stagehand) {
                return stagehand
            }

            // ── Model routing (shared by both local and cloud paths) ──────────
            const groqApiKey = process.env.GROQ_API_KEY
            const geminiApiKey =
                process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY

            let modelName: string
            let modelApiKey: string | undefined

            const requestedModel = process.env.STAGEHAND_MODEL

            if (requestedModel?.startsWith("google/") && geminiApiKey) {
                modelName = requestedModel
                modelApiKey = geminiApiKey
            } else if (requestedModel?.startsWith("groq/") && groqApiKey) {
                modelName = requestedModel
                modelApiKey = groqApiKey
            } else if (groqApiKey) {
                modelName = "groq/openai/gpt-oss-120b"
                modelApiKey = groqApiKey
            } else if (geminiApiKey) {
                modelName = "google/gemini-flash-lite-latest"
                modelApiKey = geminiApiKey
            } else {
                throw new Error(
                    "No AI model API key found. Set GROQ_API_KEY or GEMINI_API_KEY in your environment."
                )
            }

            // ── Browser routing ───────────────────────────────────────────────
            // Set USE_LOCAL_BROWSER=true in .env.local to run on your own machine
            // for free (unlimited, visible Chrome window). Leave unset to use
            // Browserbase cloud sessions.
            const useLocal = process.env.USE_LOCAL_BROWSER === "true"

            if (useLocal) {
                // ── LOCAL PATH: opens Chrome with Playwright video recording + Stagehand ──
                logger.info("Using local browser (USE_LOCAL_BROWSER=true)")
                const { chromium } = await import("playwright")
                const { localBrowser } = await import("@browserbasehq/stagehand")
                const { getAvailablePort } = await import("@/features/workflows/lib/ports")
                const path = await import("path")
                const fs = await import("fs")
                // Resolve profile directory:
                // Check if user has any connected accounts matching the workflow's target URL,
                // or use the first connected account, or fall back to default profile.
                let selectedProfile = ".local-browser-profile"
                try {
                    const accounts = await listConnectedAccounts(orgId)
                    if (accounts.length > 0) {
                        const openUrlNodes = nodes.filter(
                            (n) => (n.data as any)?.type === "open-url"
                        )
                        const targetUrls = openUrlNodes
                            .map((n) => String((n.data as any)?.values?.url || ""))
                            .join(" ")
                            .toLowerCase()

                        const matched = accounts.find((acc) => {
                            const plat = acc.platform.toLowerCase()
                            return (
                                targetUrls.includes(plat) ||
                                (plat === "wellfound" && (targetUrls.includes("wellfound") || targetUrls.includes("angel.co"))) ||
                                (plat === "linkedin" && targetUrls.includes("linkedin"))
                            )
                        })

                        if (matched) {
                            selectedProfile = matched.profileDir
                            logger.info(`Using connected account profile: "${matched.name}" (${selectedProfile})`)
                        } else if (accounts.length === 1) {
                            selectedProfile = accounts[0].profileDir
                            logger.info(`Using single connected account profile: "${accounts[0].name}" (${selectedProfile})`)
                        }
                    }
                } catch (accErr) {
                    logger.warn("Could not load connected accounts, using default profile", {
                        error: String(accErr),
                    })
                }

                const profileDir = path.resolve(process.cwd(), selectedProfile)
                fs.mkdirSync(profileDir, { recursive: true })

                localRecordingsDir = path.resolve(process.cwd(), ".local-recordings")
                fs.mkdirSync(localRecordingsDir, { recursive: true })

                const port = await getAvailablePort()
                logger.info(`Launching local browser on port ${port} with video recording`)

                localPlaywrightContext = await chromium.launchPersistentContext(profileDir, {
                    channel: "chrome",
                    headless: false,
                    ignoreDefaultArgs: ["--disable-extensions"],
                    recordVideo: {
                        dir: localRecordingsDir,
                        size: { width: 1280, height: 720 },
                    },
                    args: [
                        `--remote-debugging-port=${port}`,
                        "--enable-unsafe-extension-debugging",
                        "--remote-allow-origins=*",
                        "--no-first-run",
                        "--no-default-browser-check",
                    ],
                })

                try {
                    await localPlaywrightContext.tracing.start({
                        screenshots: true,
                        snapshots: true,
                        sources: true,
                    })
                } catch (traceErr) {
                    logger.warn("Failed to start tracing", { error: String(traceErr) })
                }

                const stagehandBrowser = await localBrowser.connect({
                    cdpUrl: `http://127.0.0.1:${port}`,
                })

                stagehand = await Stagehand.create({
                    browser: stagehandBrowser,
                    model: {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        modelName: modelName as any,
                        apiKey: modelApiKey,
                    },
                })
                sessionId = `local_${runId}`
                return stagehand
            }

            // ── CLOUD PATH: Browserbase ───────────────────────────────────────
            const apiKey = process.env.BROWSERBASE_API_KEY
            if (!apiKey) {
                throw new Error("BROWSERBASE_API_KEY is not set")
            }

            try {
                if (process.env.BROWSERBASE_CONTEXT_ID) {
                    // Create the session manually to guarantee the Context attaches
                    const { Browserbase } = await import("@browserbasehq/sdk")
                    const bb = new Browserbase({ apiKey })

                    const session = await bb.sessions.create({
                        projectId: process.env.BROWSERBASE_PROJECT_ID,
                        browserSettings: {
                            context: {
                                id: process.env.BROWSERBASE_CONTEXT_ID,
                                persist: true,
                            },
                        },
                        userMetadata: { stagehand: "true" },
                    })

                    sessionId = session.id
                    browser = await browserbase.connect({ apiKey, sessionId: session.id })
                } else {
                    // Fall back to standard launch if no Context is configured
                    browser = await browserbase.launch({
                        apiKey,
                        userMetadata: { stagehand: "true" },
                    })
                    sessionId = browser.sessionId
                }
            } catch (error) {
                // Stagehand swallows the underlying API error and throws
                // a generic BrowserbaseSessionError without the cause.
                // Probe Browserbase SDK directly to get the real error (e.g. 402 quota, 401 auth).
                let detailedMessage: string | undefined
                try {
                    const { Browserbase } = await import("@browserbasehq/sdk")
                    const bb = new Browserbase({ apiKey })
                    await bb.sessions.create({
                        projectId: process.env.BROWSERBASE_PROJECT_ID,
                    })
                } catch (sdkError: any) {
                    detailedMessage =
                        sdkError?.message ||
                        (sdkError?.error ? `${sdkError.error}: ${sdkError.message}` : undefined)
                }

                const finalError = detailedMessage
                    ? new Error(`Browserbase session creation failed: ${detailedMessage}`)
                    : error

                logger.error("Browserbase session launch failed", {
                    message:
                        finalError instanceof Error
                            ? finalError.message
                            : String(finalError),
                    originalError:
                        error instanceof Error
                            ? error.message
                            : String(error),
                })
                throw finalError
            }

            // Give the Browserbase browser to Stagehand.
            stagehand = await Stagehand.create({
                browser,
                model: {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    modelName: modelName as any,
                    apiKey: modelApiKey,
                },
            })

            return stagehand
        }

        // Outputs of every node that has already run, keyed by node id.
        // Populated as we go so downstream nodes can reference upstream
        // outputs via {{ nodeId.path }} placeholders.
        const outputs: Record<string, unknown> = {}

        const updateStep = (
            stepId: string,
            updates: Partial<RunStep>
        ): void => {
            if (!steps.some((step) => step.id === stepId)) {
                return
            }

            steps = steps.map((step) =>
                step.id === stepId ? { ...step, ...updates } : step
            )
            metadata.set("steps", steps as any)
        }

        const setStepStatus = (
            stepId: string,
            status: RunStep["status"],
            extra?: Partial<RunStep>
        ): void => {
            updateStep(stepId, { status, ...extra })
        }

        try {
            for (const id of order) {
                const node = byId.get(id)

                if (!node) {
                    throw new Error(`Node ${id} not found`)
                }

                const logContext = {
                    nodeId: node.id,
                    nodeType: node.data.type,
                    title: node.data.title,
                }

                console.log(`NODE_EXEC_START ${node.id} "${node.data.title}" ${node.data.type}`)
                logger.info("Node START", logContext)

                const stepStartTime = Date.now()
                const startedAt = new Date().toISOString()

                setStepStatus(node.id, "running", {
                    startedAt,
                })
                await metadata.flush()

                try {
                    const executor =
                        node.data.kind === "action"
                            ? nodeExecutors[node.data.type]
                            : undefined

                    if (node.data.kind === "action" && !executor) {
                        throw new Error(
                            `No executor registered for node type "${node.data.type}"`
                        )
                    }

                    let result: unknown = undefined

                    if (executor) {
                        // Resolve any {{ nodeId.path }} placeholders in this
                        // node's field values against outputs collected so far.
                        const resolvedValues = Object.fromEntries(
                            Object.entries(node.data.values).map(([key, value]) => [
                                key,
                                interpolate(value, outputs),
                            ])
                        )

                        // Retry the step in-place so transient Browserbase /
                        // navigation errors don't kill the whole workflow.
                        // Prior outputs and the stagehand session survive.
                        result = await retryStep(
                            () =>
                                executor({
                                    nodeId: node.id,
                                    values: resolvedValues,
                                    getStagehand,
                                    outputs,
                                    nodes,
                                    edges,
                                    steps,
                                }),
                            {
                                maxAttempts: STEP_MAX_ATTEMPTS,
                                minTimeoutInMs: STEP_RETRY_MIN_TIMEOUT_MS,
                                maxTimeoutInMs: STEP_RETRY_MAX_TIMEOUT_MS,
                                label: node.data.title,
                            },
                        )

                        outputs[node.id] = result
                    }

                    const completedAt = new Date().toISOString()
                    const durationMs = Date.now() - stepStartTime

                    setStepStatus(node.id, "done", {
                        completedAt,
                        finishedAt: completedAt,
                        durationMs,
                        output: result,
                    })
                    await metadata.flush()
                    console.log(`NODE_EXEC_SUCCESS ${node.id} "${node.data.title}" ${node.data.type}`)
                    logger.info("Node SUCCESS", logContext)
                } catch (error) {
                    console.log(`NODE_EXEC_ERROR ${node.id} "${node.data.title}" ${node.data.type}`)
                    const errorMessage =
                        error instanceof Error
                            ? error.message
                            : String(error)
                    const errorStack =
                        error instanceof Error ? error.stack : undefined

                    logger.error("Node ERROR", {
                        ...logContext,
                        message: errorMessage,
                        stack: errorStack,
                    })

                    const completedAt = new Date().toISOString()
                    const durationMs = Date.now() - stepStartTime

                    setStepStatus(node.id, "failed", {
                        completedAt,
                        finishedAt: completedAt,
                        durationMs,
                        error: errorMessage,
                        errorStack,
                    })

                    const isBlockedError =
                        errorMessage.toLowerCase().includes("captcha") ||
                        errorMessage.toLowerCase().includes("turnstile") ||
                        errorMessage.toLowerCase().includes("cloudflare") ||
                        errorMessage.toLowerCase().includes("human intervention") ||
                        errorMessage.toLowerCase().includes("security challenge") ||
                        errorMessage.toLowerCase().includes("waitpoint")

                    const failedGoalEvaluation: GoalEvaluation = {
                        achieved: false,
                        status: isBlockedError ? "blocked" : "not_achieved",
                        goal: node.data.title,
                        summary: `Step "${node.data.title}" failed: ${errorMessage}`,
                        evidence: errorMessage,
                    }
                    metadata.set("goalEvaluation", failedGoalEvaluation as any)
                    await metadata.flush()
                    throw error
                }
            }

            // Derive overall goal evaluation from completed steps
            const agentOrVerifyStep = steps
                .slice()
                .reverse()
                .find(
                    (s) =>
                        (s.nodeType === "verify" || s.nodeType === "agent") &&
                        s.status === "done" &&
                        s.output !== undefined
                )

            if (
                agentOrVerifyStep &&
                typeof agentOrVerifyStep.output === "object" &&
                agentOrVerifyStep.output !== null
            ) {
                const out = agentOrVerifyStep.output as any
                const rawStatus = out.status as string | undefined
                const resolvedStatus: GoalEvaluationStatus =
                    rawStatus === "achieved" ||
                    rawStatus === "not_achieved" ||
                    rawStatus === "unverified" ||
                    rawStatus === "blocked"
                        ? rawStatus
                        : (out.achieved ?? out.success ?? true)
                          ? "achieved"
                          : "not_achieved"

                goalEvaluation = {
                    achieved: resolvedStatus === "achieved",
                    status: resolvedStatus,
                    goal: out.criterion || agentOrVerifyStep.title,
                    summary:
                        out.summary ||
                        out.message ||
                        (resolvedStatus === "achieved"
                            ? "Goal successfully verified."
                            : resolvedStatus === "unverified"
                              ? "Outcome unverified: insufficient evidence."
                              : resolvedStatus === "blocked"
                                ? "Execution blocked by security gate or human action."
                                : "Goal was not achieved."),
                    evidence: out.evidence,
                }
            } else {
                goalEvaluation = {
                    achieved: true,
                    status: "achieved",
                    summary: `All ${steps.length} workflow steps completed successfully.`,
                }
            }

            metadata.set("goalEvaluation", goalEvaluation as any)
            await metadata.flush()

            // Synchronize application or discovery outcome with Airtable if configured
            try {
                const { syncWorkflowExecutionOutcome } = await import(
                    "@/lib/airtable/workflow-sync"
                )
                airtableSyncResult = await syncWorkflowExecutionOutcome({
                    steps,
                    outputs,
                    goalEvaluation,
                    runId,
                })
                if (airtableSyncResult?.synced) {
                    logger.info("Airtable workflow outcome synchronized", {
                        status: airtableSyncResult.statusAssigned,
                    })
                }
            } catch (airtableSyncErr) {
                logger.warn("Airtable sync warning (non-blocking)", {
                    error: String(airtableSyncErr),
                })
            }

            return {
                steps,
                sessionId,
                goalEvaluation,
            }
        } catch (err) {
            workflowError = err
            throw err
        } finally {
            // Build and display end-of-run workflow summary
            try {
                const durationMs = Date.now() - workflowStartTime
                const summary = buildWorkflowSummary({
                    workflowName: workflow?.name || "Workflow",
                    workflowId,
                    runId,
                    durationMs,
                    steps,
                    outputs,
                    goalEvaluation,
                    airtableSyncResult,
                    error: workflowError,
                })

                console.log("\n" + summary.text + "\n")
                logger.info("Workflow execution summary generated", {
                    runId,
                    status: workflowError ? "FAILED" : "COMPLETED",
                    durationMs,
                    confirmedApplications: summary.data.confirmedCount,
                    attemptedApplications: summary.data.attemptedCount,
                })

                try {
                    metadata.set("workflowSummary", summary.data as any)
                    await metadata.flush()
                } catch {}
            } catch (summaryErr) {
                logger.warn("Failed to generate workflow summary (non-blocking)", {
                    error: String(summaryErr),
                })
            }
            // Stagehand does NOT own the Browserbase or Playwright browser.
            // Close Stagehand first, then the browser / Playwright context.
            // Safely catch cleanup errors so socket teardowns do not mark successful runs as failed.
            try {
                await stagehand?.close()
            } catch (closeError) {
                logger.warn("Stagehand close warning", {
                    message:
                        closeError instanceof Error
                            ? closeError.message
                            : String(closeError),
                })
            }
            try {
                await browser?.close()
            } catch (closeError) {
                logger.warn("Browser close warning", {
                    message:
                        closeError instanceof Error
                            ? closeError.message
                            : String(closeError),
                })
            }

            if (localPlaywrightContext) {
                try {
                    const fs = await import("fs")
                    const path = await import("path")

                    // 1. Save trace file as insurance policy
                    if (localRecordingsDir) {
                        const traceFile = path.join(localRecordingsDir, `${runId}-trace.zip`)
                        try {
                            await localPlaywrightContext.tracing.stop({ path: traceFile })
                            logger.info(`Saved local execution trace to ${traceFile}`)
                        } catch (traceErr) {
                            logger.warn("Failed to save local execution trace", { error: String(traceErr) })
                        }
                    }

                    // 2. Obtain path to recorded video before closing context
                    let videoPath: string | undefined
                    for (const page of localPlaywrightContext.pages()) {
                        try {
                            const v = page.video()
                            if (v) {
                                videoPath = await v.path()
                                break
                            }
                        } catch {
                            // ignore
                        }
                    }

                    // 3. Close Playwright context (this flushes the .webm video file to disk)
                    await localPlaywrightContext.close()

                    // 4. Rename the video to deterministic name: ${runId}.webm
                    if (videoPath && fs.existsSync(videoPath) && localRecordingsDir) {
                        const targetPath = path.join(localRecordingsDir, `${runId}.webm`)
                        try {
                            if (fs.existsSync(targetPath)) {
                                fs.unlinkSync(targetPath)
                            }
                            fs.renameSync(videoPath, targetPath)
                            logger.info(`Saved local video replay to ${targetPath}`)
                        } catch (renameErr) {
                            logger.warn("Failed to rename video replay file", {
                                from: videoPath,
                                to: targetPath,
                                error: String(renameErr),
                            })
                        }
                    }
                } catch (pwCleanupErr) {
                    logger.warn("Playwright context close warning", {
                        message:
                            pwCleanupErr instanceof Error
                                ? pwCleanupErr.message
                                : String(pwCleanupErr),
                    })
                }
            }
        }
    },
})

type RetryStepOptions = {
    maxAttempts: number
    minTimeoutInMs: number
    maxTimeoutInMs: number
    label: string
}

// In-process retry of a single step. The Trigger.dev task-level retry
// would re-run the entire workflow (and launch a new Browserbase
// session), which is wasteful for transient failures like a single
// timed-out page navigation. This keeps the session alive and re-runs
// only the failing step.
async function retryStep<T>(
    fn: () => Promise<T>,
    opts: RetryStepOptions,
): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error
            if (attempt >= opts.maxAttempts) {
                break
            }
            const backoff = computeBackoff(attempt, opts)
            logger.warn(`Step "${opts.label}" failed (attempt ${attempt}/${opts.maxAttempts}), retrying in ${backoff}ms`, {
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
            })
            await new Promise((resolve) => setTimeout(resolve, backoff))
        }
    }
    throw lastError
}

function computeBackoff(
    attempt: number,
    opts: RetryStepOptions,
): number {
    // Exponential backoff with full jitter, capped at maxTimeoutInMs.
    const base = Math.min(
        opts.maxTimeoutInMs,
        opts.minTimeoutInMs * 2 ** (attempt - 1),
    )
    return Math.floor(Math.random() * base)
}