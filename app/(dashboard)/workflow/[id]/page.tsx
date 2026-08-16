import { notFound } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { getWorkflow } from "@/features/workflows/data"

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { orgId } = await auth()
  const { id } = await params

  if (!orgId) notFound()

  const [workflow] = await getWorkflow(id, orgId)
  if (!workflow) notFound()

  return (
    <div className="flex min-h-full flex-1 flex-col gap-2 p-2 md:p-2.5">
      <header className="flex items-center justify-between rounded-2xl border border-solid border-border/70 bg-background/80 px-4 py-3 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.35)] backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{workflow.name}</h1>
        </div>
      </header>

      <div className="flex min-h-full flex-1 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/40">
        <p className="text-sm text-muted-foreground">
          Workflow editor coming soon
        </p>
      </div>
    </div>
  )
}
