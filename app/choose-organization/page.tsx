import { TaskChooseOrganization } from "@clerk/nextjs"

export default function ChooseOrganizationPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Workspace access
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Choose an organization
          </h1>
          <p className="text-sm text-muted-foreground">
            Select an organization to continue, or create a new one to get started.
          </p>
        </div>

        <TaskChooseOrganization redirectUrlComplete="/" />
      </div>
    </main>
  )
}
