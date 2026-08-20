import { auth, clerkClient } from "@clerk/nextjs/server"

import { liveblocks } from "@/lib/liveblocks"

export async function POST() {
  const { userId, orgId } = await auth()

  if (!userId || !orgId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)

  const { status, body } = await liveblocks.identifyUser(
    {
      userId,
      groupIds: [orgId],
      organizationId: orgId,
    },
    {
      userInfo: {
        name: user.fullName ?? user.username ?? "Anonymous",
        avatar: user.imageUrl,
      },
    }
  )

  return new Response(body, { status })
}