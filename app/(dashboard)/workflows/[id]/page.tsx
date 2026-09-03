import { notFound } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { ReactFlowProvider } from "@xyflow/react"

import { getWorkflow } from "@/features/workflows/data"
import { Flow } from "@/features/workflows/components/flow"
import { Room } from "@/features/workflows/components/room"
import { WorkflowShell } from "@/features/workflows/components/workflow-shell"
import { liveblocks } from "@/lib/liveblocks"

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { orgId } = await auth()
  const { id } = await params

  if (!orgId) notFound()

  const workflow = await getWorkflow(orgId, id)
  if (!workflow) notFound()

  await liveblocks.getOrCreateRoom(id, {
    organizationId: orgId,
    defaultAccesses: [],
    groupsAccesses: {
      [orgId]: ["room:write"],
    },
    metadata: {
      name: workflow.name,
    },
  })

  return (
    <div className="flex min-h-full flex-1 flex-col gap-2 p-2 md:p-2.5">
      <header className="flex items-center justify-between rounded-2xl border border-solid border-border/70 bg-background/80 px-4 py-3 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.35)] backdrop-blur-sm">
        <h1 className="text-lg font-semibold">{workflow.name}</h1>
      </header>

      <div className="flex min-h-full flex-1 rounded-2xl border border-border/70 bg-background/40">
        <Room roomId={id}>
          <ReactFlowProvider>
            <WorkflowShell workflowId={id}>
              <Flow />
            </WorkflowShell>
          </ReactFlowProvider>
        </Room>
      </div>
    </div>
  )
}
