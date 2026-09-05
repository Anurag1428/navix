"use client"

import { useMemo } from "react"
import { useStore } from "@xyflow/react"

import {
    nodeRegistry,
    type NodeOutput,
    type NodeType,
    type StepNodeType,
} from "@/features/workflows/nodes/node-registry"

export type UpstreamToken = {
    token: string
    label: string
    sourceType: NodeType
}

export type UpstreamValues = Record<string, Record<string, string>>

// Every node id that can reach `selectedId` by following edges backward,
// including the transitive closure. The selected node itself is excluded.
function collectUpstreamIds(
    selectedId: string | undefined,
    edges: { source: string; target: string }[],
): string[] {
    if (!selectedId) return []

    const upstream = new Set<string>()
    const queue: string[] = [selectedId]
    const visited = new Set<string>([selectedId])

    while (queue.length > 0) {
        const current = queue.shift()!
        for (const edge of edges) {
            if (edge.target !== current) continue
            if (visited.has(edge.source)) continue
            visited.add(edge.source)
            upstream.add(edge.source)
            queue.push(edge.source)
        }
    }

    return [...upstream]
}

export function useUpstreamConnections(
    selectedId: string | undefined,
): UpstreamToken[] {
    const edges = useStore((s) => s.edges)
    const nodes = useStore((s) => s.nodes) as StepNodeType[]

    return useMemo(() => {
        const upstreamIds = collectUpstreamIds(selectedId, edges)
        if (upstreamIds.length === 0) return []

        const byId = new Map(nodes.map((n) => [n.id, n]))
        const tokens: UpstreamToken[] = []

        for (const id of upstreamIds) {
            const node = byId.get(id)
            if (!node) continue

            const outputs: NodeOutput[] =
                nodeRegistry[node.data.type]?.outputs ?? []

            for (const output of outputs) {
                tokens.push({
                    token: `{{ ${node.id}.${output.path} }}`,
                    label: `${node.data.title} · ${output.label}`,
                    sourceType: node.data.type,
                })
            }
        }

        return tokens
    }, [selectedId, edges, nodes])
}

// The current field values of every node upstream of `selectedId`, keyed by
// node id. Used to render a live preview of what a field's {{ token }} placeholders
// would expand to at edit time, before any run has produced real outputs.
export function useUpstreamValues(
    selectedId: string | undefined,
): UpstreamValues {
    const edges = useStore((s) => s.edges)
    const nodes = useStore((s) => s.nodes) as StepNodeType[]

    return useMemo(() => {
        const upstreamIds = collectUpstreamIds(selectedId, edges)
        const values: UpstreamValues = {}

        for (const node of nodes) {
            if (!upstreamIds.includes(node.id)) continue
            values[node.id] = { ...node.data.values }
        }

        return values
    }, [selectedId, edges, nodes])
}