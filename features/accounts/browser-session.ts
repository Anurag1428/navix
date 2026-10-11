import path from "path"
import fs from "fs"
import { spawn, exec, type ChildProcess } from "child_process"

// Map of active browser sessions by session token/id
const activeSessions = new Map<
  string,
  {
    process: ChildProcess
    profileDir: string
    platform: string
  }
>()

function findChromeExecutable(): string {
  try {
    const { getChromePath } = require("chrome-launcher")
    const chromePath = getChromePath()
    if (chromePath && fs.existsSync(chromePath)) return chromePath
  } catch {
    // continue to fallbacks
  }

  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
  } else if (process.platform === "darwin") {
    const macPath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if (fs.existsSync(macPath)) return macPath
  } else {
    const linuxPaths = ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"]
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p
    }
  }

  throw new Error("Google Chrome could not be found. Please ensure Google Chrome is installed on this machine.")
}

export async function startAccountLoginSession({
  sessionId,
  platform,
  loginUrl,
  existingProfileDir,
}: {
  sessionId: string
  platform: string
  loginUrl: string
  existingProfileDir?: string
}) {
  // Close any existing session with this id
  if (activeSessions.has(sessionId)) {
    await closeAccountLoginSession(sessionId)
  }

  // Sanitize platform name for directory
  const safePlatform = platform.toLowerCase().replace(/[^a-z0-9]/g, "_")
  const relativeDir = existingProfileDir || path.join(".local-browser-profiles", `${safePlatform}_${sessionId}`)
  const profileDir = path.resolve(process.cwd(), relativeDir)

  fs.mkdirSync(profileDir, { recursive: true })

  const chromePath = findChromeExecutable()

  // Launch normal headful Chrome pointing to the persistent profile directory
  const proc = spawn(
    chromePath,
    [
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      loginUrl,
    ],
    {
      detached: true,
      stdio: "ignore",
    }
  )

  proc.unref()

  activeSessions.set(sessionId, {
    process: proc,
    profileDir: relativeDir,
    platform,
  })

  return {
    profileDir: relativeDir,
  }
}

export async function closeAccountLoginSession(sessionId: string) {
  const session = activeSessions.get(sessionId)
  if (!session) return null

  try {
    if (session.process && session.process.pid) {
      if (process.platform === "win32") {
        exec(`taskkill /pid ${session.process.pid} /T /F`, () => {})
      } else {
        session.process.kill()
      }
    }
  } catch (err) {
    console.warn("[Accounts] Warning closing browser session:", err)
  }

  activeSessions.delete(sessionId)
  return session.profileDir
}

export function isSessionActive(sessionId: string): boolean {
  return activeSessions.has(sessionId)
}
