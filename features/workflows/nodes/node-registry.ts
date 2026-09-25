import type { Node } from "@xyflow/react"
import { Globe, Mail, MousePointerClick, ScanSearch, Search, type LucideIcon, Bot } from "lucide-react"
import { Zap } from "lucide-react"

export type StepNodeKind = "trigger" | "action"

// One editable field on a node, rendered as an input in the inspector later.
export type NodeField = {
  key: string
  label: string
  placeholder?: string
  multiline?: boolean
  required?: boolean
}

export type NodeOutput = {
  path: string
  label: string
}

// A node type's manifest entry. Add a node by adding an entry to nodeRegistry.
export type NodeDefinition = {
  type: string
  kind: StepNodeKind
  label: string
  icon: LucideIcon
  accent: string // Tailwind classes for the icon chip color
  fields: NodeField[]
  outputs: NodeOutput[]
}

export const nodeRegistry = {
  start: {
    type: "start",
    kind: "trigger",
    label: "Start",
    icon: MousePointerClick,
    accent: "bg-blue-500 text-white",
    fields: [],
    outputs: [],
  },
  "open-url": {
    type: "open-url",
    kind: "action",
    label: "Open URL",
    icon: Globe,
    accent: "bg-emerald-500 text-white",
    fields: [
      { key: "url", label: "URL", placeholder: "https://youtube.com", required: true },
      ],
      outputs: [
        { path: "url", label: "URL" },
        { path: "title", label: "Title" },
      ],
  },
  act: {
    type: "act",
    kind: "action",
    label: "Act",
    icon: Zap,
    accent: "bg-violet-500 text-white",
    fields: [
      { key: "instruction", label: "Instruction", placeholder: "Click the sign in button", multiline: true, required: true },
    ],
    outputs: [
      { path: "success", label: "Success" },
      { path: "message", label: "Message" },
      { path: "url", label: "URL" },
    ],
  },
  extract: {
    type: "extract",
    kind: "action",
    label: "Extract",
    icon: ScanSearch,
    accent: "bg-amber-500 text-white",
    fields: [
      { key: "instruction", label: "Instruction", placeholder: "Extract all product names and prices", multiline: true, required: true },
    ],
    outputs: [
      { path: "result", label: "Result" },
    ],
  },
  observe: {
    type: "observe",
    kind: "action",
    label: "Observe",
    icon: Search,
    accent: "bg-cyan-500 text-white",
    fields: [
      { key: "instruction", label: "Instruction", placeholder: "Find the sign in button", multiline: true, required: true },
    ],
    outputs: [
      { path: "matches", label: "Matches" },
      { path: "selector", label: "Selector" },
      { path: "description", label: "Description" },
    ],
  },
  agent: {
    type: "agent",
    kind: "action",
    label: "Agent",
    icon: Bot,
    accent: "bg-pink-500 text-white",
    fields: [
      { key: "instruction", label: "Instruction", placeholder: "Search for the stock price of NVDA and summarize the results", multiline: true, required: true },
    ],
    outputs: [
      { path: "success", label: "Success" },
      { path: "message", label: "Message" },
      { path: "completed", label: "Completed" },
      { path: "url", label: "URL" },
    ],
  },
  "send-email": {
    type: "send-email",
    kind: "action",
    label: "Send Email",
    icon: Mail,
    accent: "bg-red-500 text-white",
    fields: [
      { key: "recipient", label: "Recipient", placeholder: "user@example.com", required: true },
      { key: "subject", label: "Subject", placeholder: "Hello", required: true },
      { key: "body", label: "Body", placeholder: "Email body here", multiline: true, required: true },
    ],
    outputs: [
      { path: "id", label: "Email ID" },
    ],
  },
} satisfies Record<string, NodeDefinition>

export type NodeType = keyof typeof nodeRegistry

// Plain JSON only (synced through Liveblocks later). type keys into the registry;
// kind and title are denormalized so the server can read them without the registry.
export type StepNodeData = {
  type: NodeType
  kind: StepNodeKind
  title: string
  values: Record<string, string>
}

export type StepNodeType = Node<StepNodeData, "step">

export type ActionNodeType = {
  [K in NodeType] : (typeof nodeRegistry)[K]["kind"] extends "action" ? K : never
}[NodeType]