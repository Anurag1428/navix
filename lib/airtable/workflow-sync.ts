import {
  confirmApplication,
  formatDate,
  hasAppliedTo,
  listJobRecords,
  recordApplicationAttempt,
  saveDiscoveredJob,
} from "./service.ts"
import { isAirtableConfigured } from "./client.ts"
import type { AirtableRecord, JobStatus } from "./types.ts"
import type { GoalEvaluation, RunStep } from "@/features/workflows/tasks/run-workflow"

export interface ResubmissionGuardResult {
  blocked: boolean
  status?: JobStatus
  reason?: string
  record?: AirtableRecord | null
}

/**
 * Checks whether a job has already been marked as Applied, Assessment,
 * Interview, or Offer in Airtable, protecting against accidental repeated submissions.
 * Also protects Application Attempted as an unresolved state to prevent blind automatic retries.
 */
export async function checkJobResubmissionGuard(params: {
  company?: string
  jobTitle?: string
  jobUrl?: string
}): Promise<ResubmissionGuardResult> {
  if (!isAirtableConfigured()) {
    return { blocked: false }
  }

  const { company, jobTitle, jobUrl } = params
  if (!company && !jobUrl) {
    return { blocked: false }
  }

  try {
    const check = await hasAppliedTo(company || "", jobTitle, jobUrl)
    if (check.applied && check.record) {
      const status = check.record.fields.Status
      const dateApplied = check.record.fields["Date Applied"] || "a previous date"
      return {
        blocked: true,
        status,
        reason: `Application blocked: '${check.record.fields.Name}' is already marked as '${status}' (applied on ${dateApplied}). Accidental duplicate submission prevented.`,
        record: check.record,
      }
    }

    if (check.record && check.record.fields.Status === "Application Attempted") {
      return {
        blocked: true,
        status: "Application Attempted",
        reason: `Application blocked: '${check.record.fields.Name}' has status 'Application Attempted' (unresolved previous attempt). Duplicate submission prevented until manual review.`,
        record: check.record,
      }
    }
  } catch (err) {
    console.warn("[Airtable Guard] Failed to check existing application status:", err)
  }

  return { blocked: false }
}

/**
 * Synchronizes discovered job items extracted from a workflow run into Airtable.
 */
export async function syncWorkflowDiscovery(params: {
  extractedData: unknown
  sourceUrl?: string
  runId?: string
}): Promise<{ syncedCount: number; records: AirtableRecord[] }> {
  if (!isAirtableConfigured() || !params.extractedData) {
    return { syncedCount: 0, records: [] }
  }

  const items: Array<Record<string, any>> = []
  const data = params.extractedData as any

  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "object" && item !== null) items.push(item)
    }
  } else if (typeof data === "object" && data !== null) {
    if (Array.isArray(data.jobs)) {
      items.push(...data.jobs)
    } else if (Array.isArray(data.listings)) {
      items.push(...data.listings)
    } else if (data.company || data.title || data.jobTitle) {
      items.push(data)
    }
  }

  const records: AirtableRecord[] = []

  for (const item of items) {
    const company = (item.company || item.companyName || "").trim()
    const jobTitle = (item.jobTitle || item.title || item.role || item.position || "").trim()
    const jobUrl = (item.jobUrl || item.url || item.link || params.sourceUrl || "").trim()

    if (!company || !jobTitle) continue

    try {
      const { record } = await saveDiscoveredJob({
        company,
        jobTitle,
        jobUrl,
        location: item.location,
        salary: item.salary || item.compensation,
        source: item.source || (params.sourceUrl ? "Navix Discovery Workflow" : undefined),
        notes: item.description || item.notes,
        navixRunId: params.runId,
      })
      records.push(record)
    } catch (err) {
      console.warn(`[Airtable Discovery] Failed to sync discovered job '${company} - ${jobTitle}':`, err)
    }
  }

  return { syncedCount: records.length, records }
}

export interface ExtractedJobItem {
  company: string
  jobTitle: string
  jobUrl?: string
  status?: JobStatus
  evidence?: string
  notes?: string
  source?: string
  salary?: string
  location?: string
  isVerified?: boolean
}

/**
 * Detects whether a URL is a generic root, search, or index page (e.g. wellfound.com/jobs)
 * rather than a specific individual job listing URL.
 */
export function isGenericSearchUrl(url?: string): boolean {
  if (!url || typeof url !== "string") return true
  try {
    const trimmed = url.trim()
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return true
    const parsed = new URL(trimmed)
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "") // remove trailing slash

    if (!path || path === "") return true

    const genericPaths = [
      "/jobs",
      "/job",
      "/jobs/search",
      "/search",
      "/explore",
      "/careers",
      "/find-jobs",
      "/browse",
    ]
    if (genericPaths.includes(path)) return true

    if (host.includes("wellfound.com") || host.includes("angel.co")) {
      if (path === "/jobs" || path === "/discover" || path === "/recruit" || path.startsWith("/jobs/search")) {
        return true
      }
    }

    if (host.includes("linkedin.com")) {
      if (path === "/jobs" || path.startsWith("/jobs/search")) return true
    }

    if (host.includes("indeed.com")) {
      if (path === "/jobs" || path === "/browsejobs") return true
    }

    return false
  } catch {
    return true
  }
}

/**
 * Parses natural-language agent messages, summaries, or instructions into one or more structured job items.
 *
 * SAFETY RULE: Jobs extracted from prose narrative alone MUST NOT be marked 'Applied'.
 * They are preserved as 'Application Attempted' (unresolved) without falsely claiming verified success.
 */
export function parseJobsFromText(
  text: string,
  defaultUrl?: string,
  defaultEvidence?: string,
  isVerified = false
): ExtractedJobItem[] {
  if (!text || typeof text !== "string") return []

  const trimmed = text.trim()
  // Guard against phrases indicating 0 jobs, search completion, or exhaustion
  if (
    /(?:applied|confirmed)\s+(?:to\s+)?0\s+jobs?/i.test(trimmed) ||
    /applied\s+and\s+confirmed\s+0/i.test(trimmed) ||
    /0\s+(?:jobs?|listings?)\s+applied/i.test(trimmed) ||
    /no\s+(?:unapplied|matching|new)\s+(?:jobs|listings)/i.test(trimmed) ||
    /search\s+(?:exhausted|completed|finished)/i.test(trimmed)
  ) {
    return []
  }

  const results: ExtractedJobItem[] = []
  const cleanText = trimmed.replace(/\.+$/, "")
  const cleanUrl = isGenericSearchUrl(defaultUrl) ? undefined : defaultUrl

  // Pattern 1: Colon format
  // "Successfully applied to 2 jobs at Steinn Labs: React JS Developer and Python Developer"
  // "Applied to 2 jobs at Steinn Labs: 1. React JS Developer 2. Python Developer"
  const colonMatch = cleanText.match(
    /(?:successfully\s+)?applied\s+to\s+(?:(\d+)\s+jobs?\s+at\s+)?([^:.\n]+):\s*([^.\n]+)/i
  )
  if (colonMatch) {
    let company = colonMatch[2].trim()
    company = company.replace(/^(?:the\s+company\s+|company\s+)/i, "").trim()

    const rawRoles = colonMatch[3].trim()
    let roles: string[] = []
    if (/\d+\.\s+/.test(rawRoles)) {
      roles = rawRoles
        .split(/\d+\.\s+/)
        .map((r) => r.trim())
        .filter(Boolean)
    } else {
      roles = rawRoles
        .split(/\s*,\s*and\s*|\s+and\s+|\s*,\s*/i)
        .map((r) => r.replace(/^[-•*–\s]+|[-•*–\s]+$/g, "").trim())
        .filter(Boolean)
    }

    if (company && roles.length > 0) {
      for (const role of roles) {
        if (role.length > 1) {
          results.push({
            company,
            jobTitle: role,
            jobUrl: cleanUrl,
            evidence: defaultEvidence || text,
            isVerified: false,
            status: "Application Attempted",
            notes: "Application attempted in workflow run. Individual submission proof was unresolved from aggregate summary.",
          })
        }
      }
      if (results.length > 0) return results
    }
  }

  // Pattern 2: Parentheses format
  // "Successfully applied to 2 jobs at Steinn Labs (React JS Developer and Python Developer)"
  const parenMatch = cleanText.match(
    /(?:successfully\s+)?applied\s+to\s+(?:(\d+)\s+jobs?\s+at\s+)?([^(.\n]+)\s*\(([^)]+)\)/i
  )
  if (parenMatch) {
    const company = parenMatch[2].trim()
    const rawRoles = parenMatch[3].trim()
    const roles = rawRoles
      .split(/\s*,\s*and\s*|\s+and\s+|\s*,\s*/i)
      .map((r) => r.trim())
      .filter(Boolean)

    if (company && roles.length > 0) {
      for (const role of roles) {
        if (role.length > 1) {
          results.push({
            company,
            jobTitle: role,
            jobUrl: cleanUrl,
            evidence: defaultEvidence || text,
            isVerified: false,
            status: "Application Attempted",
            notes: "Application attempted in workflow run. Individual submission proof was unresolved from aggregate summary.",
          })
        }
      }
      if (results.length > 0) return results
    }
  }

  // Pattern 3: Single job "Applied to [Role] at [Company]"
  const singleAtMatch = cleanText.match(
    /(?:successfully\s+)?applied\s+to\s+(?:the\s+)?([^:.\n]+?)\s+at\s+([^:.\n]+)/i
  )
  if (singleAtMatch && !/^\d+\s+jobs?/i.test(singleAtMatch[1].trim())) {
    const jobTitle = singleAtMatch[1].trim()
    const company = singleAtMatch[2].trim()
    if (company && jobTitle && company.length > 1 && jobTitle.length > 1) {
      results.push({
        company,
        jobTitle,
        jobUrl: cleanUrl,
        evidence: defaultEvidence || text,
        isVerified: false,
        status: "Application Attempted",
        notes: "Application attempted in workflow run. Individual submission proof was unresolved from aggregate summary.",
      })
      return results
    }
  }

  // Pattern 4: Single job "Applied to [Company] for [Role]"
  const forMatch = cleanText.match(
    /(?:successfully\s+)?applied\s+to\s+([^:.\n]+?)\s+for\s+(?:the\s+)?([^:.\n]+)/i
  )
  if (forMatch) {
    const company = forMatch[1].trim()
    const jobTitle = forMatch[2].trim()
    if (company && jobTitle && company.length > 1 && jobTitle.length > 1) {
      results.push({
        company,
        jobTitle,
        jobUrl: cleanUrl,
        evidence: defaultEvidence || text,
        isVerified: false,
        status: "Application Attempted",
        notes: "Application attempted in workflow run. Individual submission proof was unresolved from aggregate summary.",
      })
      return results
    }
  }

  // Pattern 5: Single job "Applied to [Company] - [Role]"
  const hyphenMatch = cleanText.match(
    /(?:successfully\s+)?applied\s+to\s+([^-:\n]+?)\s*-\s*([^:.\n]+)/i
  )
  if (hyphenMatch) {
    const company = hyphenMatch[1].trim()
    const jobTitle = hyphenMatch[2].trim()
    if (company && jobTitle && company.length > 1 && jobTitle.length > 1) {
      results.push({
        company,
        jobTitle,
        jobUrl: cleanUrl,
        evidence: defaultEvidence || text,
        isVerified: false,
        status: "Application Attempted",
        notes: "Application attempted in workflow run. Individual submission proof was unresolved from aggregate summary.",
      })
      return results
    }
  }

  // Pattern 6: Title / instruction fallback: "Apply to [Company] for [Role]" or "[Company] - [Role]"
  const applyMatch = cleanText.match(/apply\s+to\s+([^-\s]+(?:\s+[^-\s]+)?)\s+(?:for\s+)?(.*)/i)
  if (applyMatch) {
    const company = applyMatch[1]?.trim()
    const jobTitle = applyMatch[2]?.trim()
    if (company && jobTitle && company.length > 1 && jobTitle.length > 1) {
      results.push({
        company,
        jobTitle,
        jobUrl: cleanUrl,
        evidence: defaultEvidence || text,
        isVerified: false,
        status: "Application Attempted",
        notes: "Application attempted in workflow run. Individual submission proof was unresolved from aggregate summary.",
      })
      return results
    }
  }

  const fallbackHyphenMatch = cleanText.match(/^([^-:\n]+?)\s*-\s*([^:\n]+)$/)
  if (fallbackHyphenMatch) {
    const left = fallbackHyphenMatch[1].trim()
    const right = fallbackHyphenMatch[2].trim()
    const isProsePhrase = /^(?:search|status|completed|applied|confirmed|attempted|inspected|task|result|summary|visited|overview|notice|note|target|all|no|mode)\b/i.test(left)
    const hasPunctuation = /[.!?]/.test(left) || /[.!?]/.test(right)
    if (!isProsePhrase && !hasPunctuation && left.length >= 2 && right.length >= 2 && left.length < 50 && right.length < 80) {
      results.push({
        company: left,
        jobTitle: right,
        jobUrl: cleanUrl,
        evidence: defaultEvidence || text,
        isVerified: false,
        status: "Application Attempted",
        notes: "Application attempted in workflow run. Individual submission proof was unresolved from aggregate summary.",
      })
      return results
    }
  }

  return results
}

/**
 * Extracts all target jobs and metadata from workflow execution context,
 * handling agent application outputs, extract node listings, and open-url steps.
 */
export function extractJobsFromContext(params: {
  steps?: RunStep[]
  outputs?: Record<string, unknown>
}): ExtractedJobItem[] {
  const { steps = [], outputs = {} } = params
  const jobs: ExtractedJobItem[] = []

  // 1. Resolve fallback URL from open-url or outputs
  let defaultUrl: string | undefined
  const openUrlStep = steps.find((s) => s.nodeType === "open-url")
  if (openUrlStep && outputs[openUrlStep.id]) {
    const out = outputs[openUrlStep.id] as any
    if (out.url) defaultUrl = out.url
  }
  if (!defaultUrl) {
    for (const val of Object.values(outputs)) {
      if (typeof val === "object" && val !== null && (val as any).url) {
        defaultUrl = (val as any).url
        break
      }
    }
  }

  // 2. Check for extract node outputs (job discovery / listings)
  for (const [key, out] of Object.entries(outputs)) {
    if (!out || typeof out !== "object") continue
    const anyOut = out as any

    const candidateLists = [
      anyOut.result,
      anyOut.jobs,
      anyOut.listings,
      anyOut.items,
    ].filter(Boolean)

    for (const list of candidateLists) {
      if (Array.isArray(list)) {
        for (const item of list) {
          if (typeof item === "object" && item !== null) {
            const company = (item.company || item.companyName || "").trim()
            const jobTitle = (item.jobTitle || item.title || item.role || item.position || "").trim()
            if (company && jobTitle) {
              const itemUrl = item.jobUrl || item.url || item.link
              const validItemUrl = isGenericSearchUrl(itemUrl) ? undefined : itemUrl
              jobs.push({
                company,
                jobTitle,
                jobUrl: validItemUrl,
                location: item.location,
                salary: item.salary || item.compensation,
                source: item.source || (isGenericSearchUrl(defaultUrl) ? `Discovered on ${defaultUrl}` : undefined),
                notes: item.description || item.notes,
                status: "Discovered",
                isVerified: false,
              })
            }
          }
        }
      }
    }

    // Check for explicit company and jobTitle directly on the output object
    if (anyOut.company && (anyOut.jobTitle || anyOut.role || anyOut.title)) {
      const explicitUrl = anyOut.jobUrl || anyOut.url
      const validUrl = isGenericSearchUrl(explicitUrl) ? undefined : explicitUrl
      const hasSpecificProof = Boolean(anyOut.evidence && anyOut.evidence.length > 5 && anyOut.achieved)
      jobs.push({
        company: anyOut.company.trim(),
        jobTitle: (anyOut.jobTitle || anyOut.role || anyOut.title).trim(),
        jobUrl: validUrl,
        evidence: anyOut.evidence,
        notes: anyOut.notes || anyOut.summary,
        status: anyOut.status || (hasSpecificProof ? "Applied" : "Discovered"),
        isVerified: hasSpecificProof,
      })
    }
  }

  // 3. Check for structured per-job outcomes from Agent (confirmedJobs, attemptedJobs)
  for (const [key, out] of Object.entries(outputs)) {
    if (!out || typeof out !== "object") continue
    const anyOut = out as any

    const structuredConfirmed = anyOut.confirmedJobs || anyOut.appliedJobs
    if (Array.isArray(structuredConfirmed) && structuredConfirmed.length > 0) {
      for (const item of structuredConfirmed) {
        if (typeof item === "object" && item !== null) {
          const company = (item.company || "").trim()
          const jobTitle = (item.role || item.jobTitle || "").trim()
          if (company && jobTitle) {
            const itemUrl = item.url
            const validUrl = isGenericSearchUrl(itemUrl) ? undefined : itemUrl
            const itemEvidence = (item.evidence || anyOut.evidence || "").trim()
            const hasSpecificEvidence = itemEvidence.length > 5
            jobs.push({
              company,
              jobTitle,
              jobUrl: validUrl,
              evidence: itemEvidence || "Per-job submission confirmed in browser.",
              isVerified: hasSpecificEvidence,
              status: hasSpecificEvidence ? "Applied" : "Application Attempted",
              notes: item.notes || item.reason,
            })
          }
        }
      }
    }

    if (Array.isArray(anyOut.attemptedJobs) && anyOut.attemptedJobs.length > 0) {
      for (const item of anyOut.attemptedJobs) {
        if (typeof item === "object" && item !== null) {
          const company = (item.company || "").trim()
          const jobTitle = (item.role || item.jobTitle || "").trim()
          if (company && jobTitle) {
            // Prevent duplicate if already recorded (e.g. as confirmed/applied)
            const alreadyRecorded = jobs.some(
              (j) =>
                j.company.toLowerCase() === company.toLowerCase() &&
                j.jobTitle.toLowerCase() === jobTitle.toLowerCase()
            )
            if (alreadyRecorded) continue

            const itemUrl = item.url
            const validUrl = isGenericSearchUrl(itemUrl) ? undefined : itemUrl
            jobs.push({
              company,
              jobTitle,
              jobUrl: validUrl,
              evidence: item.evidence || "Application attempted without confirmed submission.",
              isVerified: false,
              status: "Application Attempted",
              notes: item.reason || "Attempted application without verified confirmation.",
            })
          }
        }
      }
    }
  }

  // 4. Fallback: Parse agent natural language outputs ONLY if no structured jobs were found
  // AND no agent node explicitly reported structured job arrays (which means 0 genuine jobs were found/applied).
  const hasAgentStructuredOutput = Object.values(outputs).some((out: any) =>
    out &&
    typeof out === "object" &&
    (Array.isArray(out.confirmedJobs) || Array.isArray(out.attemptedJobs) || Array.isArray(out.appliedJobs))
  )

  if (jobs.length === 0 && !hasAgentStructuredOutput) {
    for (const [key, out] of Object.entries(outputs)) {
      if (!out || typeof out !== "object") continue
      const anyOut = out as any

      const resolvedUrl = anyOut.url || defaultUrl
      const evidence = anyOut.evidence || anyOut.summary || anyOut.message

      const candidateTexts = [anyOut.message, anyOut.summary, anyOut.evidence].filter(Boolean)
      for (const text of candidateTexts) {
        const parsed = parseJobsFromText(text, resolvedUrl, evidence, false)
        if (parsed.length > 0) {
          jobs.push(...parsed)
          break
        }
      }
    }
  }

  // 5. Fallback: inspect step titles and values from steps
  if (jobs.length === 0 && !hasAgentStructuredOutput && steps.length > 0) {
    for (const step of steps) {
      if (step.nodeType === "agent" || step.nodeType === "verify") {
        const text = step.title || ""
        const parsed = parseJobsFromText(text, defaultUrl, undefined, false)
        if (parsed.length > 0) {
          jobs.push(...parsed)
          break
        }
      }
    }
  }

  // Deduplicate by company + jobTitle
  const unique: ExtractedJobItem[] = []
  const seen = new Set<string>()
  for (const j of jobs) {
    const key = `${j.company.toLowerCase()}::${j.jobTitle.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(j)
    }
  }

  return unique
}

/**
 * Parses target company, job title, and URL from workflow steps or node outputs.
 */
export function extractJobDetailsFromWorkflow(params: {
  steps: RunStep[]
  outputs: Record<string, unknown>
}): { company?: string; jobTitle?: string; jobUrl?: string } {
  const jobs = extractJobsFromContext(params)
  if (jobs.length > 0) {
    return {
      company: jobs[0].company,
      jobTitle: jobs[0].jobTitle,
      jobUrl: jobs[0].jobUrl,
    }
  }
  return {}
}

/**
 * Synchronizes the overall outcome of a workflow execution into Airtable.
 *
 * Rules:
 * - If goal achieved with evidence: sets status = "Applied"
 * - If goal unverified or failed: sets status = "Application Attempted"
 * - Never throws or disrupts workflow execution if Airtable call fails.
 */
export async function syncWorkflowExecutionOutcome(params: {
  steps: RunStep[]
  outputs: Record<string, unknown>
  goalEvaluation?: GoalEvaluation
  runId: string
}): Promise<{
  synced: boolean
  statusAssigned?: JobStatus
  error?: string
}> {
  if (!isAirtableConfigured()) {
    return { synced: false }
  }

  // If the workflow already contained an explicit 'airtable' node, do not duplicate
  const hasAirtableNode = params.steps.some((s) => s.nodeType === "airtable")
  if (hasAirtableNode) {
    return { synced: false }
  }

  const { company, jobTitle, jobUrl } = extractJobDetailsFromWorkflow({
    steps: params.steps,
    outputs: params.outputs,
  })

  // If we couldn't identify a company or job title, this might not be an application workflow
  if (!company || !jobTitle) {
    // Check if it's an extract discovery workflow
    const extractStep = params.steps.find((s) => s.nodeType === "extract")
    if (extractStep && params.outputs[extractStep.id]) {
      const out = params.outputs[extractStep.id] as any
      await syncWorkflowDiscovery({
        extractedData: out.result,
        sourceUrl: jobUrl,
        runId: params.runId,
      })
      return { synced: true, statusAssigned: "Discovered" }
    }
    return { synced: false }
  }

  const evalStatus = params.goalEvaluation?.status
  const isVerified =
    evalStatus === "achieved" &&
    Boolean(params.goalEvaluation?.evidence && params.goalEvaluation.evidence.length > 5)

  const evidence =
    params.goalEvaluation?.evidence ||
    params.goalEvaluation?.summary ||
    "Workflow completed without explicit evidence."

  try {
    const result = await confirmApplication({
      company,
      jobTitle,
      jobUrl,
      evidence,
      isVerified,
      navixRunId: params.runId,
      notes: params.goalEvaluation?.summary,
    })

    return {
      synced: result.success,
      statusAssigned: result.statusAssigned,
      error: result.syncError,
    }
  } catch (syncErr) {
    // CRITICAL: Failed Airtable sync must NEVER fail a successful application run
    const errorMsg = syncErr instanceof Error ? syncErr.message : String(syncErr)
    console.warn(`[Airtable Workflow Sync] Non-blocking sync error: ${errorMsg}`)
    return {
      synced: false,
      error: errorMsg,
    }
  }
}

export interface RecentAirtableApplication {
  company: string
  role?: string
  dateApplied?: string
  jobUrl?: string
  jobId?: string
}

/**
 * Loads recent applications from Airtable bounded to a specific time window (default 3 days)
 * to seed the agent's memory with jobs that should not be revisited.
 * Bounding to 3 days keeps the prompt small and prevents token bloat.
 */
export async function getRecentApplicationsFromAirtable(
  windowDays: number = 3
): Promise<RecentAirtableApplication[]> {
  if (!isAirtableConfigured()) {
    return []
  }

  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - windowDays)
    const appliedAfterOrOn = formatDate(cutoffDate)

    const records = await listJobRecords({
      status: ["Applied", "Application Attempted", "Assessment", "Interview", "Offer"],
      appliedAfterOrOn,
      limit: 100,
    })

    const seen = new Set<string>()
    const results: RecentAirtableApplication[] = []

    for (const r of records) {
      const company = (r.fields.Company || r.fields.Name?.split(" - ")[0] || "").trim()
      const role = (r.fields["Job Title"] || r.fields.Name?.split(" - ")[1] || "").trim()
      const dateApplied = (r.fields["Date Applied"] || r.fields["Date Discovered"] || "").trim()
      const rawJobUrl = (r.fields["Job URL"] || "").trim()
      const jobId = r.id

      if (!company) continue

      const key = `${company.toLowerCase()}::${role.toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        results.push({
          company,
          role: role || undefined,
          dateApplied,
          jobUrl: rawJobUrl || undefined,
          jobId,
        })
      }
    }

    return results
  } catch (err) {
    console.warn("[Airtable Sync] Failed to load recent applications for memory bridge:", err)
    return []
  }
}

