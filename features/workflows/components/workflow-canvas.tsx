"use client"

import { useCallback, useSyncExternalStore } from "react"

import { useTheme } from "next-themes"

import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useEdgesState,
  useNodesState,
  ConnectionLineType,
  type ColorMode,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react"

import "@xyflow/react/dist/style.css"

const initialNodes: Node[] = [
  {
    id: "n1",
    position: { x: 0, y: 0 },
    data: { label: "Start" },
    type: "input",
  },
  {
    id: "n2",
    position: { x: 0, y: 150 },
    data: { label: "Run a task" },
  },
  {
    id: "n3",
    position: { x: 0, y: 300 },
    data: { label: "End" },
    type: "output",
  },
]

const initialEdges: Edge[] = [
  {
    id: "n1-n2",
    source: "n1",
    target: "n2",
    type: "smoothstep",
    label: "connects with",
  },
  {
    id: "n2-n3",
    source: "n2",
    target: "n3",
    type: "smoothstep",
    label: "connects with",
  },
]

const emptySubscribe = () => () => {}

export function WorkflowCanvas() {
  const { resolvedTheme } = useTheme()
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((edgesSnapshot) => addEdge(connection, edgesSnapshot)),
    [setEdges],
  )

  return (
    <div className="size-full">
      <ReactFlow
        colorMode={(mounted ? (resolvedTheme ?? "light") : "light") as ColorMode}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: "var(--border)" }}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { stroke: "var(--border)"},
        }}
        style={
          {
            "--xy-background-color": "var(--background)",
            "--xy-edge-stroke-width": 2,
            "--xy-connectionline-stroke-width": 2,
          } as React.CSSProperties
        }
        maxZoom={1}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}