"use client"

import { TriangleAlert } from "lucide-react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Button } from "@/components/ui/button"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-full flex-1 p-2 md:p-2.5">
      <Empty className="min-h-full w-full rounded-2xl border border-solid border-border/70 bg-background/80 p-6 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.35)] backdrop-blur-sm md:p-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert className="size-6" />
          </EmptyMedia>
          <EmptyContent>
            <EmptyTitle>Something went wrong</EmptyTitle>
            <EmptyDescription>
              Failed to load this workflow ({error.message || "unknown error"}).
              Try again or go back.
            </EmptyDescription>
          </EmptyContent>
          <div className="mt-4 flex gap-2">
            <Button onClick={reset}>Try again</Button>
          </div>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
