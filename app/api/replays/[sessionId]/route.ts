import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { Browserbase } from "@browserbasehq/sdk"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { userId, orgId } = await auth()

  if (!userId || !orgId) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const { sessionId } = await params
  if (!sessionId) {
    return new NextResponse("Missing sessionId", { status: 400 })
  }

  const apiKey = process.env.BROWSERBASE_API_KEY
  if (!apiKey) {
    return new NextResponse("BROWSERBASE_API_KEY is not configured", {
      status: 500,
    })
  }

  import("@sentry/nextjs").then((Sentry) => {
    Sentry.getIsolationScope().setAttributes({
      action: "getReplay",
      orgId,
      sessionId,
    })
    Sentry.logger.info("Replay requested", { sessionId })
  })

  const pageId = request.nextUrl.searchParams.get("pageId")
  const bb = new Browserbase({ apiKey })

  try {
    let targetPageId = pageId

    // If pageId was not explicitly passed, retrieve page metadata first
    if (!targetPageId) {
      const meta = await bb.sessions.replays.retrieve(sessionId)
      if (!meta.pages || meta.pages.length === 0) {
        return new NextResponse("Recording not ready", { status: 404 })
      }
      targetPageId = meta.pages[0].pageId
    }

    const playlist = await bb.sessions.replays.retrievePage(
      sessionId,
      targetPageId
    )
    const m3u8 = await playlist.text()

    return new NextResponse(m3u8, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    })
  } catch (error: unknown) {
    // Pass through status codes from Browserbase (e.g. 404 for not-ready, 429 for rate limits)
    const err = error as
      { status?: number; statusCode?: number; message?: string } | undefined
    const status =
      typeof err?.status === "number"
        ? err.status
        : typeof err?.statusCode === "number"
          ? err.statusCode
          : 500

    if (status >= 500) {
      import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error))
    }

    const message =
      err?.message || (error instanceof Error ? error.message : "Replay error")

    return new NextResponse(message, { status })
  }
}
