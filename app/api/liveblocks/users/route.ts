import { auth, clerkClient } from "@clerk/nextjs/server"
import { getUserColor } from "@/lib/utils"

interface RequestBody {
  userIds?: string[]
}

export async function POST(req: Request) {
  const { userId, orgId } = await auth()

  if (!userId || !orgId) {
    return new Response("Unauthorized", { status: 401 })
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return Response.json([])
  }

  const { userIds } = body

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return Response.json([])
  }

  const uniqueUserIds = Array.from(
    new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0))
  )

  if (uniqueUserIds.length === 0) {
    return Response.json(userIds.map(() => null))
  }

  const clerk = await clerkClient()

  // Clerk's getUserList supports up to 100 user IDs per call
  const chunkSize = 100
  const chunks: string[][] = []
  for (let i = 0; i < uniqueUserIds.length; i += chunkSize) {
    chunks.push(uniqueUserIds.slice(i, i + chunkSize))
  }

  const userResponses = await Promise.all(
    chunks.map((chunkIds) =>
      clerk.users.getUserList({
        userId: chunkIds,
        limit: chunkIds.length,
      })
    )
  )

  const userMap = new Map<string, { name: string; avatar?: string; color?: string }>()

  for (const response of userResponses) {
    for (const user of response.data) {
      const name = user.fullName ?? user.username ?? "Anonymous"
      userMap.set(user.id, {
        name,
        avatar: user.imageUrl,
        color: getUserColor(user.id),
      })
    }
  }

  const users = userIds.map((id) => userMap.get(id) ?? null)

  return Response.json(users)
}
