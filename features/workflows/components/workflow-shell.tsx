"use client"

import { useState } from "react"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

import { RightSidebar } from "./right-sidebar"
import { RunFeedback } from "./run-feedback"

export type ActiveRun = {
  runId: string
  publicAccessToken: string
}

export function WorkflowShell() {
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null)

  return (
    <ResizablePanelGroup orientation="horizontal" className="size-full">
      <ResizablePanel minSize="30rem" className="size-full">
        <ResizablePanelGroup orientation="vertical" className="size-full">
          <ResizablePanel minSize="18rem">
            <div className="flex size-full items-center justify-center">
              <p className="text-sm text-muted-foreground">Canvas</p>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="8rem" minSize="6rem">
            <div className="flex size-full flex-col overflow-hidden">
              <div className="border-b border-border/70 px-3 py-1.5">
                <p className="text-xs font-medium text-muted-foreground">Logs</p>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {activeRun ? (
                  <RunFeedback
                    key={activeRun.runId}
                    runId={activeRun.runId}
                    publicAccessToken={activeRun.publicAccessToken}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <p className="text-sm text-muted-foreground">
                      Press Run to see live task feedback
                    </p>
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="16rem" minSize="14rem" maxSize="36rem">
        <RightSidebar onRun={setActiveRun} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
