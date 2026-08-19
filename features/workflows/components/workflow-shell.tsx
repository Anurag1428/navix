"use client"

import { createContext, useContext, type ReactNode } from "react"

const WorkflowContext = createContext<string | null>(null)

export function WorkflowShell({
  workflowId,
  children,
}: {
  workflowId: string
  children: ReactNode
}) {
  return (
    <WorkflowContext.Provider value={workflowId}>
      {children}
    </WorkflowContext.Provider>
  )
}

export function useWorkflowId() {
  const workflowId = useContext(WorkflowContext)
  if (!workflowId) {
    throw new Error("useWorkflowId must be used within a WorkflowShell")
  }
  return workflowId
}