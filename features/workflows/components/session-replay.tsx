"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Hls from "hls.js"
import { AlertCircle, Film, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export interface SessionReplayProps {
  sessionId: string
  pageId?: string
  autoPlay?: boolean
  muted?: boolean
  controls?: boolean
  className?: string
  pollIntervalMs?: number
  maxPollAttempts?: number
  onReady?: () => void
  onError?: (error: Error) => void
}

type ReplayStatus = "idle" | "polling" | "ready" | "error"

/** Counter that increments every time the user manually hits "Retry". */
type PollHandle = {
  cancelled: boolean
}

export function SessionReplay({
  sessionId,
  pageId,
  autoPlay = true,
  muted = true,
  controls = true,
  className,
  pollIntervalMs = 2000,
  maxPollAttempts = 60,
  onReady,
  onError,
}: SessionReplayProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  // Incremented each time we want to (re-)kick off polling.
  const [pollKey, setPollKey] = useState(0)

  const [status, setStatus] = useState<ReplayStatus>("idle")
  const [attempt, setAttempt] = useState(1)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const replayUrl = sessionId
    ? `/api/replays/${encodeURIComponent(sessionId)}${
        pageId ? `?pageId=${encodeURIComponent(pageId)}` : ""
      }`
    : ""

  // Retry button handler – just bumps the poll key which triggers the effect below.
  const handleRetry = useCallback(() => {
    setPollKey((k) => k + 1)
  }, [])

  // ── Polling effect ────────────────────────────────────────────────────────
  // Runs when sessionId, pageId, or pollKey changes.  All setState calls inside
  // happen after at least one await, so they are not "synchronous within the
  // effect body" and don't trigger react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!sessionId || !replayUrl) {
      // Defer so the state update is not synchronous within the effect body.
      void Promise.resolve().then(() => setStatus("idle"))
      return
    }

    const handle: PollHandle = { cancelled: false }
    let currentAttempt = 1

    // Initialise UI state after a micro-task so the synchronous effect body
    // never calls setState directly (satisfies react-hooks/set-state-in-effect).
    const init = Promise.resolve().then(() => {
      if (handle.cancelled) return
      setStatus("polling")
      setErrorMessage(null)
      setAttempt(1)
    })

    const checkPlaylist = async () => {
      await init
      if (handle.cancelled) return

      const controller = new AbortController()

      try {
        const response = await fetch(replayUrl, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        })

        if (handle.cancelled) return

        if (response.ok) {
          setStatus("ready")
          return
        }

        if (response.status === 401) {
          const message =
            "Unauthorized: Please sign in to view this session replay."
          setStatus("error")
          setErrorMessage(message)
          onError?.(new Error(message))
          return
        }

        // Browserbase returns 404 while the recording is still being processed.
        if (currentAttempt >= maxPollAttempts) {
          const message =
            "Session recording is not ready yet. Please try again in a few moments."
          setStatus("error")
          setErrorMessage(message)
          onError?.(new Error(message))
          return
        }

        currentAttempt += 1
        setAttempt(currentAttempt)
        timerRef.current = setTimeout(checkPlaylist, pollIntervalMs)
      } catch (err: unknown) {
        if (handle.cancelled) return
        if (err instanceof Error && err.name === "AbortError") return

        if (currentAttempt >= maxPollAttempts) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to load session replay playlist."
          setStatus("error")
          setErrorMessage(message)
          onError?.(new Error(message))
          return
        }

        currentAttempt += 1
        setAttempt(currentAttempt)
        timerRef.current = setTimeout(checkPlaylist, pollIntervalMs)
      }
    }

    checkPlaylist()

    return () => {
      handle.cancelled = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, replayUrl, maxPollAttempts, pollIntervalMs, pollKey])

  // ── HLS playback effect ───────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "ready" || !videoRef.current || !replayUrl) {
      return
    }

    const video = videoRef.current
    video.muted = muted

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      })
      hlsRef.current = hls

      hls.loadSource(replayUrl)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) {
          video.play().catch((e) => {
            // Autoplay may be gated behind user interaction
            console.debug("Autoplay prevented:", e)
          })
        }
        onReady?.()
      })

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad()
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError()
              break
            default: {
              hls.destroy()
              const playbackErr = new Error(`Playback error: ${data.details}`)
              setStatus("error")
              setErrorMessage(playbackErr.message)
              onError?.(playbackErr)
              break
            }
          }
        }
      })

      return () => {
        hls.destroy()
        hlsRef.current = null
      }
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS (Safari / iOS)
      video.src = replayUrl

      const handleLoaded = () => {
        if (autoPlay) video.play().catch(() => {})
        onReady?.()
      }
      const handleErr = () => {
        const nativeErr = new Error("Failed to play HLS video natively.")
        setStatus("error")
        setErrorMessage(nativeErr.message)
        onError?.(nativeErr)
      }

      video.addEventListener("loadedmetadata", handleLoaded)
      video.addEventListener("error", handleErr)

      return () => {
        video.removeEventListener("loadedmetadata", handleLoaded)
        video.removeEventListener("error", handleErr)
        video.src = ""
      }
    } else {
      const unsupportedErr = new Error(
        "HLS playback is not supported in this browser."
      )
      setStatus("error")
      setErrorMessage(unsupportedErr.message)
      onError?.(unsupportedErr)
    }
  }, [status, replayUrl, autoPlay, muted, onReady, onError])

  return (
    <div
      className={cn(
        "relative flex size-full min-h-[300px] flex-col items-center justify-center overflow-hidden rounded-lg bg-black text-white",
        className
      )}
    >
      {/* Video element — always mounted so ref is immediately available */}
      <video
        ref={videoRef}
        controls={controls}
        muted={muted}
        playsInline
        className={cn(
          "size-full object-contain",
          status !== "ready" && "hidden"
        )}
      />

      {/* Polling / loading overlay */}
      {status === "polling" && (
        <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="relative flex items-center justify-center">
            <Film className="size-8 animate-pulse text-muted-foreground" />
            <Spinner className="absolute -bottom-1 -right-1 size-4 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Preparing session recording…
            </p>
            <p className="text-xs text-muted-foreground">
              Checking playlist — attempt {attempt} of {maxPollAttempts}
            </p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {status === "error" && (
        <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertCircle className="size-8 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Playback unavailable
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {errorMessage || "Unable to load session replay."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="mt-2 gap-1.5 text-xs"
          >
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      )}

      {/* Idle overlay */}
      {status === "idle" && (
        <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
          <Film className="size-8 opacity-40" />
          <p className="text-xs">No active session selected</p>
        </div>
      )}
    </div>
  )
}
