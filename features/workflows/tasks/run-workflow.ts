import toposort from "toposort"
import { logger, metadata, task } from "@trigger.dev/sdk"
import { browserbase, Stagehand } from "@browserbasehq/stagehand"

import { nodeExecutors } from "@/features/workflows/nodes/node-executors"
import { getWorkflow } from "@/features/workflows/data"
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

export type RunWorkflowOutput = {
    steps: RunStep[]
    sessionId?: string
}

// How many times to retry a single step before giving up. The step
// is re-executed in-place; prior step outputs and the Browserbase
// session are preserved across retries.
const STEP_MAX_ATTEMPTS = 3
const STEP_RETRY_MIN_TIMEOUT_MS = 1_000
const STEP_RETRY_MAX_TIMEOUT_MS = 10_000

export const runWorkflowTask = task({
    id: "run-workflow",

    run: async ({
        workflowId,
        orgId,
    }: {
        workflowId: string
        orgId: string
    }) => {
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

            if (groqApiKey) {
                modelName = process.env.STAGEHAND_MODEL || "groq/openai/gpt-oss-120b"
                modelApiKey = groqApiKey
            } else if (geminiApiKey) {
                modelName = process.env.STAGEHAND_MODEL || "google/gemini-flash-2.0"
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
                // ── LOCAL PATH: opens a visible Chrome window on your machine ──
                logger.info("Using local browser (USE_LOCAL_BROWSER=true)")
                const { localBrowser } = await import("@browserbasehq/stagehand")
                const path = await import("path")
                const fs = await import("fs")
                // Store browser cookies/session in a local folder so you stay
                // logged in between runs — the local equivalent of Browserbase Contexts.
                const profileDir = path.resolve(process.cwd(), ".local-browser-profile")
                // chrome-launcher requires the directory to exist before launch
                fs.mkdirSync(profileDir, { recursive: true })
                const localBrowserInstance = await localBrowser.launch({
                    headless: false, // Visible window so you can watch it run
                    userDataDir: profileDir,
                    preserveUserDataDir: true, // Keep cookies after browser closes
                })
                stagehand = await Stagehand.create({
                    browser: localBrowserInstance,
                    model: {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        modelName: modelName as any,
                        apiKey: modelApiKey,
                    },
                })
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
                    await metadata.flush()
                    throw error
                }
            }

            return {
                steps,
                sessionId,
            }
        } finally {
            // Stagehand does NOT own the Browserbase browser.
            // Close Stagehand first, then the browser.
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