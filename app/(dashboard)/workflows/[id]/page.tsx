import { WorkflowShell } from "@/features/workflows/components/workflow-shell"

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="flex min-h-full flex-1 flex-col gap-2 p-2 md:p-2.5">
      <header className="flex items-center justify-between rounded-2xl border border-solid border-border/70 bg-background/80 px-4 py-3 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.35)] backdrop-blur-sm">
        <h1 className="text-lg font-semibold">Workflow {id}</h1>
      </header>

      <div className="flex min-h-full flex-1 rounded-2xl border border-border/70 bg-background/40">
        <WorkflowShell />
      </div>
    </div>
  )
}
