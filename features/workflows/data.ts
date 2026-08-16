import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/index";
import { workflows } from "@/lib/db/schema";

export function listWorkflows(orgId: string) {
  return db
    .select()
    .from(workflows)
    .where(eq(workflows.orgId, orgId))
    .orderBy(desc(workflows.createdAt));
}

export function createWorkflow(orgId: string, name: string) {
  return db
    .insert(workflows)
    .values({ orgId, name })
    .returning();
}

export function getWorkflow(id: string, orgId: string) {
  return db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id) && eq(workflows.orgId, orgId));
}