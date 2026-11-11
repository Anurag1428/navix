import fs from "node:fs"
import path from "node:path"
import type { CandidateProfile } from "./types.ts"

export const DEFAULT_CANDIDATE_PROFILE: CandidateProfile = {
  name: "Anurag",
  title: "Full-Stack & Systems Engineer (AI Agents & Automations)",
  coreSkills: [
    "TypeScript",
    "React 19",
    "Next.js",
    "Playwright",
    "Browser Automation",
    "Trigger.dev",
    "Node.js",
    "Python",
  ],
  proofPoints: [
    "Built Navix autonomous agent pairing Gemini Flash macro-planner with accessibility DOM pruning, saving ~17,000 tokens per action and enabling reliable mechanical action execution.",
    "Engineered cloud browser sandbox automation with Stagehand, Daytona Linux environments, and zero-compute Trigger.dev waitpoints for CAPTCHA/2FA pauses.",
    "Designed high-concurrency event-driven workflows with Drizzle ORM, Neon PostgreSQL, and Airtable staging integrations.",
  ],
  portfolioUrl: "https://starter-pack-iota.vercel.app/",
  githubUrl: "https://github.com/Anurag1428",
  linkedinUrl: "https://www.linkedin.com/in/anurag-dev",
}

/**
 * Resolves the candidate profile from overrides, environment variables, or config/candidate-profile.json.
 */
export function loadCandidateProfile(override?: CandidateProfile): CandidateProfile {
  if (override && override.name) {
    return override
  }

  // Check CANDIDATE_PROFILE_JSON environment variable
  const envProfileJson = process.env.CANDIDATE_PROFILE_JSON?.trim()
  if (envProfileJson) {
    try {
      const parsed = JSON.parse(envProfileJson)
      if (parsed && typeof parsed === "object" && parsed.name) {
        return parsed as CandidateProfile
      }
    } catch {
      // Invalid JSON, fall through to config file
    }
  }

  // Attempt reading from config/candidate-profile.json
  try {
    const configPath = path.resolve(process.cwd(), "config", "candidate-profile.json")
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8")
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === "object" && parsed.name) {
        return parsed as CandidateProfile
      }
    }
  } catch {
    // Config read failed, fall through to default
  }

  return DEFAULT_CANDIDATE_PROFILE
}
