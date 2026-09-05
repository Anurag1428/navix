import toposort from "toposort"
import { logger, task } from "@trigger.dev/sdk"
import { browserbase, Stagehand } from "@browserbasehq/stagehand"

import { nodeExecutors } from "@/features/workflows/nodes/node-executors"
import { getWorkflow } from "@/features/workflows/data"

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

        let browser: Awaited<ReturnType<typeof browserbase.launch>> | undefined
        let stagehand: Stagehand | undefined

        const getStagehand = async (): Promise<Stagehand> => {
            if (stagehand) {
                return stagehand
            }

            const apiKey = process.env.BROWSERBASE_API_KEY

            if (!apiKey) {
                throw new Error(
                    "BROWSERBASE_API_KEY is not set"
                )
            }

            // Create the Browserbase browser first.
            browser = await browserbase.launch({
                apiKey,
            })

            // Give the Browserbase browser to Stagehand.
            stagehand = await Stagehand.create({
                browser,
                model: {
                    modelName: "google/gemini-2.5-flash",
                },
            })

            return stagehand
        }

        try {
            for (const id of order) {
                const node = byId.get(id)

                if (!node) {
                    throw new Error(`Node ${id} not found`)
                }

                logger.log(`Running step: ${node.data.title}`)

                const executor = nodeExecutors[node.data.type]

                if (executor) {
                    await executor({
                        values: node.data.values,
                        getStagehand,
                    })
                }
            }

            return {
                steps: order.length,
            }
        } finally {
            // Stagehand does NOT own the Browserbase browser.
            // Close Stagehand first, then the browser.
            await stagehand?.close()
            await browser?.close()
        }
    },
})