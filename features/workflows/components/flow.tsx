"use client"

import { useCallback } from "react"
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
import { ConsolePanel } from "./console-panel"
import { Canvas, initialEdges, initialNodes } from "./workflow-canvas"
import { LiveblocksFlowProvider } from "./liveblocks-flow-context"
import { useWorkflowId } from "./workflow-shell"
import { useWorkflowRunsApi, type ActiveRun } from "./workflow-runs-provider"
import type { StepNodeType } from "@/features/workflows/nodes/node-registry"

export type { ActiveRun }

export function Flow() {
  const { activeRun, setActiveRun } = useWorkflowRunsApi()
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
            <ResizablePanel defaultSize="10rem" minSize="6rem">
              <ConsolePanel />
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
