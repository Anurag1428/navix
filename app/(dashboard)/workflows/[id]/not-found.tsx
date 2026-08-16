import { FileQuestion } from "lucide-react"
import Link from "next/link"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-1 p-2 md:p-2.5">
      <Empty className="min-h-full w-full rounded-2xl border border-solid border-border/70 bg-background/80 p-6 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.35)] backdrop-blur-sm md:p-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestion className="size-6" />
          </EmptyMedia>
          <EmptyContent>
            <EmptyTitle>Workflow not found</EmptyTitle>
            <EmptyDescription>
              This workflow doesn&apos;t exist or has been deleted.{" "}
              <Link href="/">Go back to your workflows</Link>
            </EmptyDescription>
          </EmptyContent>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
