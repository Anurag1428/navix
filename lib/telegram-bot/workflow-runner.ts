import { db } from "@/lib/db"
import { workflows } from "@/lib/db/schema"
import { eq, ilike, and } from "drizzle-orm"
import { tasks } from "@trigger.dev/sdk"
import type { runWorkflowTask } from "@/features/workflows/tasks/run-workflow"

// ─── List all workflows for an org ────────────────────────────────────────────

export async function listWorkflowsForOrg(orgId: string) {
    return db
        .select({ id: workflows.id, name: workflows.name })
        .from(workflows)
        .where(eq(workflows.orgId, orgId))
        .orderBy(workflows.name)
}

// ─── Find a workflow by exact name or partial match ───────────────────────────

export async function findWorkflowByName(orgId: string, query: string) {
    // Try exact match first (case-insensitive)
    const exact = await db
        .select()
        .from(workflows)
        .where(and(eq(workflows.orgId, orgId), ilike(workflows.name, query)))

    if (exact.length > 0) return exact[0]

    // Fallback: starts-with partial match
    const partial = await db
        .select()
        .from(workflows)
        .where(and(eq(workflows.orgId, orgId), ilike(workflows.name, `${query}%`)))

    return partial[0] ?? null
}

// ─── Trigger a workflow run via Trigger.dev ───────────────────────────────────

export async function triggerWorkflowRun(workflowId: string, orgId: string) {
    const handle = await tasks.trigger<typeof runWorkflowTask>(
        "run-workflow",
        { workflowId, orgId },
        { tags: [`workflow:${workflowId}`, "telegram-trigger"] }
    )
    return handle
}
