import type { Node } from "@xyflow/react"
import { Globe, Mail, MousePointerClick, ScanSearch, Search, ShieldCheck, type LucideIcon, Bot, Database } from "lucide-react"
import { Zap } from "lucide-react"

export type StepNodeKind = "trigger" | "action"

// One editable field on a node, rendered as an input in the inspector later.
export type NodeField = {
  key: string
  label: string
  placeholder?: string
  multiline?: boolean
  required?: boolean
  description?: string
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
      { key: "candidateProfile", label: "Candidate Profile", placeholder: "Skills, experience, and background for tailored applications...", multiline: true },
      { key: "maxSteps", label: "Max Steps", placeholder: "50 (default)", description: "Maximum number of browser actions before concluding (default: 50).", required: false },
    ],
    outputs: [
      { path: "success", label: "Success" },
      { path: "achieved", label: "Achieved" },
      { path: "evidence", label: "Evidence" },
      { path: "summary", label: "Summary" },
      { path: "message", label: "Message" },
      { path: "completed", label: "Completed" },
      { path: "alreadyApplied", label: "Already Applied" },
      { path: "url", label: "URL" },
    ],
  },
  verify: {
    type: "verify",
    kind: "action",
    label: "Verify Goal",
    icon: ShieldCheck,
    accent: "bg-emerald-600 text-white",
    fields: [
      {
        key: "criterion",
        label: "Custom Criterion (Optional)",
        placeholder: "Leave empty for Automatic Verification (infers goal from upstream Agent)",
        multiline: true,
        required: false,
        description: "Automatic verification is enabled by default. Leave empty to auto-verify, or enter custom requirements.",
      },
      {
        key: "expectedText",
        label: "Expected Text (Optional)",
        placeholder: "e.g. Thank you for your application",
        multiline: false,
        required: false,
        description: "Optional literal string that must appear on the page.",
      },
    ],
    outputs: [
      { path: "achieved", label: "Achieved" },
      { path: "status", label: "Status" },
      { path: "mode", label: "Mode" },
      { path: "evidence", label: "Evidence" },
      { path: "summary", label: "Summary" },
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
  airtable: {
    type: "airtable",
    kind: "action",
    label: "Airtable",
    icon: Database,
    accent: "bg-teal-500 text-white",
    fields: [
      {
        key: "mode",
        label: "Tracking Mode",
        placeholder: "auto (Automatic Tracking: zero configuration needed)",
        required: false,
        description: "auto (Default: automatically tracks discovered and applied jobs without manual field mapping) or manual",
      },
      {
        key: "operation",
        label: "Operation",
        placeholder: "auto (default) | save-discovered | confirm-application | record-attempt | check-status",
        required: false,
        description: "Operation: auto (default: infers from upstream agent/extract), save-discovered, record-attempt, confirm-application, check-status, update-status, list-followups",
      },
      {
        key: "company",
        label: "Company",
        placeholder: "e.g. Stripe (optional: auto-inferred from upstream Agent/Extract if blank)",
        required: false,
      },
      {
        key: "jobTitle",
        label: "Job Title",
        placeholder: "e.g. Full Stack Engineer (optional: auto-inferred from upstream Agent/Extract if blank)",
        required: false,
      },
      {
        key: "jobUrl",
        label: "Job URL (Optional)",
        placeholder: "e.g. {{ open-url_1.url }}",
        required: false,
      },
      {
        key: "status",
        label: "Status (Optional override)",
        placeholder: "Discovered | Applied | Interview | etc.",
        required: false,
      },
      {
        key: "evidence",
        label: "Submission Evidence (Optional)",
        placeholder: "e.g. {{ verify_1.evidence }} or {{ agent_1.evidence }}",
        multiline: true,
        required: false,
      },
      {
        key: "isVerified",
        label: "Is Verified Submission (Optional)",
        placeholder: "true | false (defaults to true if evidence is provided)",
        required: false,
      },
      {
        key: "notes",
        label: "Notes / Research (Optional)",
        placeholder: "Research insights, interview prep, or notes",
        multiline: true,
        required: false,
      },
      {
        key: "salary",
        label: "Salary (Optional)",
        placeholder: "e.g. $120k - $150k",
        required: false,
      },
      {
        key: "location",
        label: "Location (Optional)",
        placeholder: "e.g. Remote / New York",
        required: false,
      },
    ],
    outputs: [
      { path: "recordId", label: "Record ID" },
      { path: "status", label: "Status" },
      { path: "isNew", label: "Is New" },
      { path: "alreadyApplied", label: "Already Applied" },
      { path: "summary", label: "Summary" },
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