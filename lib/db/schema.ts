import type { StepNodeType } from "@/features/workflows/nodes/node-registry";
import type { Edge } from "@xyflow/react"
import {jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

// Canonical, server-readable snapshot of the flow. Mirrors React Flow's own shape 1:1 so a future executor can read
// it without remapping. Persisted by the Run action; the live editing copy still lives in the Liveblocks room.
export type WorkflowGraph = { nodes: StepNodeType[]; edges: Edge[] }

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  graph: jsonb("graph").$type<WorkflowGraph>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type Workflow = typeof workflows.$inferSelect
