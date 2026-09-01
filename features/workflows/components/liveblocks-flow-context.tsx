"use client"

import { createContext, useContext, type ReactNode } from "react"

import type { StepNodeType } from "@/features/workflows/nodes/node-registry"

type LiveblocksFlowApi = {
  /** All current nodes managed by Liveblocks. */
  nodes: readonly StepNodeType[]
  /** Add a single node (replaces if the ID already exists). */
  addNode: (node: StepNodeType) => void
}

const LiveblocksFlowContext = createContext<LiveblocksFlowApi | null>(null)

export function LiveblocksFlowProvider({
  value,
  children,
}: {
  value: LiveblocksFlowApi
  children: ReactNode
}) {
  return (
    <LiveblocksFlowContext.Provider value={value}>
      {children}
    </LiveblocksFlowContext.Provider>
  )
}

export function useLiveblocksFlowApi(): LiveblocksFlowApi {
  const ctx = useContext(LiveblocksFlowContext)
  if (!ctx) {
    throw new Error(
      "useLiveblocksFlowApi must be used within a LiveblocksFlowProvider"
    )
  }
  return ctx
}
