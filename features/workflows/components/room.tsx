"use client"

import type { ReactNode } from "react"
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
} from "@liveblocks/react/suspense"

export function Room({
  roomId,
  children,
}: {
  roomId: string
  children: ReactNode
}) {
  const publicApiKey = process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY
  if (!publicApiKey) {
    throw new Error(
      "NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY is not set — add it to .env.local",
    )
  }

  return (
    <LiveblocksProvider throttle={16} publicApiKey={publicApiKey}>
      <RoomProvider id={roomId}>
        <ClientSideSuspense fallback={<div>Loading…</div>}>
          {children}
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  )
}