"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import crypto from "crypto"

import {
  createConnectedAccount,
  deleteConnectedAccount,
  getConnectedAccount,
  listConnectedAccounts,
} from "./data"
import {
  closeAccountLoginSession,
  startAccountLoginSession,
} from "./browser-session"

export async function getAccountsAction() {
  const { orgId } = await auth()
  if (!orgId) return []
  return listConnectedAccounts(orgId)
}

export async function startConnectingAccountAction({
  platform,
  loginUrl,
}: {
  platform: string
  loginUrl: string
}) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("Unauthorized: Please sign in to an organization")

  const sessionId = crypto.randomUUID().slice(0, 8)
  const { profileDir } = await startAccountLoginSession({
    sessionId,
    platform,
    loginUrl,
  })

  return { sessionId, profileDir }
}

export async function finishConnectingAccountAction({
  sessionId,
  platform,
  name,
  loginUrl,
}: {
  sessionId: string
  platform: string
  name: string
  loginUrl?: string
}) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("Unauthorized: Please sign in to an organization")

  const profileDir = await closeAccountLoginSession(sessionId)
  if (!profileDir) {
    throw new Error("Login session expired or not found. Please try again.")
  }

  const account = await createConnectedAccount({
    orgId,
    platform,
    name: name.trim() || `${platform} Account`,
    profileDir,
    loginUrl,
  })

  revalidatePath("/accounts")
  revalidatePath("/workflows")
  return account
}

export async function deleteAccountAction(id: string) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("Unauthorized")

  await deleteConnectedAccount(orgId, id)
  revalidatePath("/accounts")
  revalidatePath("/workflows")
}

export async function openAccountBrowserAction(id: string) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("Unauthorized")

  const account = await getConnectedAccount(orgId, id)
  if (!account) throw new Error("Account not found")

  const defaultUrl =
    account.loginUrl ||
    (account.platform === "wellfound"
      ? "https://wellfound.com/jobs"
      : account.platform === "workatastartup" || account.platform === "yc"
        ? "https://www.workatastartup.com/companies"
        : account.platform === "linkedin"
          ? "https://www.linkedin.com/feed"
          : "https://google.com")

  const sessionId = crypto.randomUUID().slice(0, 8)
  await startAccountLoginSession({
    sessionId,
    platform: account.platform,
    loginUrl: defaultUrl,
    existingProfileDir: account.profileDir,
  })

  return { sessionId }
}
