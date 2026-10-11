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

export const connectedAccounts = pgTable("connected_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull(),
  platform: text("platform").notNull(), // "wellfound" | "linkedin" | "custom"
  name: text("name").notNull(), // User custom label, e.g. "My Wellfound", "Alina Parker"
  profileDir: text("profile_dir").notNull(), // Relative path, e.g. ".local-browser-profiles/123"
  loginUrl: text("login_url"), // Optional default login URL
  status: text("status").notNull().default("connected"), // "connected" | "disconnected"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type ConnectedAccount = typeof connectedAccounts.$inferSelect

