import type { Stagehand } from "@browserbasehq/stagehand"

import type {
    ActionNodeType,
    NodeType,
} from "@/features/workflows/nodes/node-registry"
import { openUrl } from "@/features/workflows/nodes/open-url"
import { actNode } from "@/features/workflows/nodes/act"
import { extractNode } from "@/features/workflows/nodes/extract"
import { observeNode } from "@/features/workflows/nodes/observe"

export type NodeContext = {
    values: Record<string, string>
    getStagehand: () => Promise<Stagehand>
}

export type NodeExecutor = (ctx: NodeContext) => Promise<unknown>

export const nodeExecutors: Partial<Record<NodeType, NodeExecutor>> = {
    "open-url": async ({ values, getStagehand }) =>
        openUrl({ stagehand: await getStagehand(), url: values.url }),
    act: async ({ values, getStagehand }) =>
        actNode({ stagehand: await getStagehand(), instruction: values.instruction }),
    extract: async ({ values, getStagehand }) =>
        extractNode({ stagehand: await getStagehand(), instruction: values.instruction }),
    observe: async ({ values, getStagehand }) =>
        observeNode({ stagehand: await getStagehand(), instruction: values.instruction }),
} satisfies Record<ActionNodeType, NodeExecutor>