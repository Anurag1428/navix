import { and, desc, eq } from "drizzle-orm"

import { db } from "@/lib/db/index"
import { connectedAccounts, type ConnectedAccount } from "@/lib/db/schema"

export function listConnectedAccounts(orgId: string): Promise<ConnectedAccount[]> {
  return db
    .select()
    .from(connectedAccounts)
    .where(eq(connectedAccounts.orgId, orgId))
    .orderBy(desc(connectedAccounts.createdAt))
}

export async function getConnectedAccount(
  orgId: string,
  id: string
): Promise<ConnectedAccount | undefined> {
  const [account] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.orgId, orgId)))

  return account
}

export async function createConnectedAccount({
  orgId,
  platform,
  name,
  profileDir,
  loginUrl,
}: {
  orgId: string
  platform: string
  name: string
  profileDir: string
  loginUrl?: string
}): Promise<ConnectedAccount> {
  const [account] = await db
    .insert(connectedAccounts)
    .values({
      orgId,
      platform,
      name,
      profileDir,
      loginUrl,
      status: "connected",
    })
    .returning()

  return account
}

export function deleteConnectedAccount(orgId: string, id: string) {
  return db
    .delete(connectedAccounts)
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.orgId, orgId)))
    .returning()
}
