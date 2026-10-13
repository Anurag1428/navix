import type { Stagehand } from "@browserbasehq/stagehand"

import type {
    ActionNodeType,
    NodeType,
    StepNodeType,
} from "@/features/workflows/nodes/node-registry"
import type { RunStep } from "@/features/workflows/tasks/run-workflow"
import { openUrl } from "@/features/workflows/nodes/open-url"
import { actNode } from "@/features/workflows/nodes/act"
import { agentNode } from "@/features/workflows/nodes/agent"
import { extractNode } from "@/features/workflows/nodes/extract"
import { observeNode } from "@/features/workflows/nodes/observe"
import { sendEmailNode } from "@/features/workflows/nodes/send-email"
import { verifyNode } from "@/features/workflows/nodes/verify"
import { airtableNode } from "@/features/workflows/nodes/airtable"

export type NodeContext = {
    nodeId?: string
    values: Record<string, string>
    getStagehand: () => Promise<Stagehand>
    outputs?: Record<string, unknown>
    nodes?: StepNodeType[]
    edges?: { source: string; target: string }[]
    steps?: RunStep[]
}

export type NodeExecutor = (ctx: NodeContext) => Promise<unknown>

export const nodeExecutors: Partial<Record<NodeType, NodeExecutor>> = {
    "open-url": async ({ values, getStagehand }) =>
        openUrl({ stagehand: await getStagehand(), url: values.url }),
    act: async ({ values, getStagehand }) =>
        actNode({ stagehand: await getStagehand(), instruction: values.instruction }),
    agent: async ({ values, getStagehand, nodeId }) =>
        agentNode({
            stagehand: await getStagehand(),
            instruction: values.instruction,
            candidateProfile: values.candidateProfile,
            nodeId,
        }),
    extract: async ({ values, getStagehand }) =>
        extractNode({ stagehand: await getStagehand(), instruction: values.instruction }),
    observe: async ({ values, getStagehand }) =>
        observeNode({ stagehand: await getStagehand(), instruction: values.instruction }),
    verify: async ({ values, getStagehand, nodeId, outputs, nodes, edges, steps }) =>
        verifyNode({
            stagehand: await getStagehand(),
            criterion: values.criterion,
            expectedText: values.expectedText,
            workflowContext: {
                nodeId,
                outputs,
                nodes,
                edges,
                steps,
            },
        }),
    "send-email": async ({ values, nodeId }) =>
        sendEmailNode({ values, nodeId }),
    airtable: async ({ values, nodeId, outputs, nodes, edges, steps }) =>
        airtableNode({ values, nodeId, outputs, nodes, edges, steps }),
} satisfies Record<ActionNodeType, NodeExecutor>