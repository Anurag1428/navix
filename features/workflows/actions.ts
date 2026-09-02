"use server"

import { auth } from "@clerk/nextjs/server"
import { tasks } from "@trigger.dev/sdk"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { liveblocks } from "@/lib/liveblocks"

import type { helloWorldTask } from "@/src/trigger/example"

import { createWorkflow, deleteWorkflow } from "./data"

export async function createWorkflowAction(name: string) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("No active organization")

  const [workflow] = await createWorkflow(orgId, name)
  revalidatePath("/workflows", "layout")
  redirect(`/workflows/${workflow.id}`)
}

export async function runWorkflowAction() {
  const { orgId } = await auth()
  if (!orgId) throw new Error("No active organization")

  const handle = await tasks.trigger<typeof helloWorldTask>("hello-world", {
    message: "Hello from right-sidebar",
  })

  return {
    runId: handle.id,
    publicAccessToken: handle.publicAccessToken,
  }
}

export async function deleteWorkflowAction(workflowId: string) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("No active organization")

  const [deleted] = await deleteWorkflow(orgId, workflowId)
  if (!deleted) throw new Error("Workflow not found")

  await liveblocks.deleteRoom(workflowId)

  revalidatePath("/workflows", "layout")
  redirect("/")
}