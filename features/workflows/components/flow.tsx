"use client"

import { useCallback, useState } from "react"
import {
  type Edge,
  type OnConnect,
  type OnDelete,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react"
import { useLiveblocksFlow } from "@liveblocks/react-flow"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

import { RightSidebar } from "./right-sidebar"
import { RunFeedback } from "./run-feedback"
import { Canvas, initialEdges, initialNodes } from "./workflow-canvas"
import { LiveblocksFlowProvider } from "./liveblocks-flow-context"
import { useWorkflowId } from "./workflow-shell"
import type { StepNodeType } from "@/features/workflows/nodes/node-registry"

export type ActiveRun = {
  runId: string
  publicAccessToken: string
}

export function Flow() {
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null)
  const workflowId = useWorkflowId()
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, onDelete } =
    useLiveblocksFlow<StepNodeType, Edge>({
      suspense: true,
      nodes: { initial: initialNodes },
      edges: { initial: initialEdges },
    })

  const addNode = useCallback(
    (node: StepNodeType) => {
      onNodesChange([{ type: "add", item: node }])
    },
    [onNodesChange]
  )

  return (
    <LiveblocksFlowProvider value={{ nodes, addNode }}>
      <ResizablePanelGroup orientation="horizontal" className="size-full">
        <ResizablePanel minSize="30rem" className="size-full">
          <ResizablePanelGroup orientation="vertical" className="size-full">
            <ResizablePanel minSize="18rem">
              <Canvas
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange as OnNodesChange<StepNodeType>}
                onEdgesChange={onEdgesChange as OnEdgesChange<Edge>}
                onConnect={onConnect as OnConnect}
                onDelete={onDelete as OnDelete<StepNodeType, Edge>}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="8rem" minSize="6rem">
              <div className="flex size-full flex-col overflow-hidden">
                <div className="border-b border-border/70 px-3 py-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Logs
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {activeRun ? (
                    <RunFeedback
                      key={activeRun.runId}
                      runId={activeRun.runId}
                      publicAccessToken={activeRun.publicAccessToken}
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <p className="text-sm text-muted-foreground">
                        Press Run to see live task feedback
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="16rem" minSize="14rem" maxSize="36rem">
          <RightSidebar workflowId={workflowId} onRun={setActiveRun} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </LiveblocksFlowProvider>
  )
}
