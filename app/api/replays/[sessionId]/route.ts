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

  // ── Local browser recording (.webm) ──────────────────────────────────────
  if (sessionId.startsWith("local_")) {
    const runId = sessionId.replace(/^local_/, "")
    const path = await import("path")
    const fs = await import("fs")

    const filePath = path.resolve(process.cwd(), ".local-recordings", `${runId}.webm`)
    if (!fs.existsSync(filePath)) {
      return new NextResponse("Recording not ready", { status: 404 })
    }

    const stat = fs.statSync(filePath)
    const fileSize = stat.size

    const range = request.headers.get("range")
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-")
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
      const chunksize = end - start + 1

      const fileStream = fs.createReadStream(filePath, { start, end })
      const stream = new ReadableStream({
        start(controller) {
          fileStream.on("data", (chunk) => controller.enqueue(chunk))
          fileStream.on("end", () => controller.close())
          fileStream.on("error", (err) => controller.error(err))
        },
        cancel() {
          fileStream.destroy()
        },
      })

      return new NextResponse(stream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize.toString(),
          "Content-Type": "video/webm",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      })
    } else {
      const fileStream = fs.createReadStream(filePath)
      const stream = new ReadableStream({
        start(controller) {
          fileStream.on("data", (chunk) => controller.enqueue(chunk))
          fileStream.on("end", () => controller.close())
          fileStream.on("error", (err) => controller.error(err))
        },
        cancel() {
          fileStream.destroy()
        },
      })

      return new NextResponse(stream, {
        status: 200,
        headers: {
          "Content-Length": fileSize.toString(),
          "Content-Type": "video/webm",
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      })
    }
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
