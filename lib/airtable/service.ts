import {
  airtableFetch,
  getCachedRecord,
  isAirtableConfigured,
  setCachedRecord,
  type AirtableRequestOptions,
} from "./client.ts"
export { isAirtableConfigured }
import {
  AirtableIntegrationError,
} from "./types.ts"
import type {
  AirtableConfig,
  AirtableRecord,
  CreateJobInput,
  FindJobQuery,
  JobApplicationFields,
  JobStatus,
  ListJobFilter,
  UpdateJobInput,
} from "./types.ts"

/**
 * Normalizes a URL for robust duplicate detection by stripping
 * protocols, www, tracking parameters (utm_*, ref, etc.), and trailing slashes.
 */
export function normalizeUrl(rawUrl?: string): string {
  if (!rawUrl) return ""
  try {
    const trimmed = rawUrl.trim()
    const parsed = new URL(
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`
    )

    // Remove tracking and session parameters
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "gh_src",
      "fbclid",
      "gclid",
      "source",
      "referrer",
      "tracking",
    ]
    for (const param of trackingParams) {
      parsed.searchParams.delete(param)
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
    let pathname = parsed.pathname.replace(/\/+$/, "")
    if (!pathname) pathname = ""

    const search = parsed.searchParams.toString()
    return `${host}${pathname}${search ? `?${search}` : ""}`.toLowerCase()
  } catch {
    return rawUrl.trim().toLowerCase().replace(/\/+$/, "")
  }
}

/**
 * Normalizes text (company names, job titles) for fuzzy secondary matching.
 */
export function normalizeText(text?: string): string {
  if (!text) return ""
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // remove punctuation
    .replace(/\s+/g, " ") // collapse multiple spaces
    .trim()
}

/**
 * Formats a Date object or string as YYYY-MM-DD.
 */
export function formatDate(date?: Date | string): string {
  if (!date) {
    const now = new Date()
    return now.toISOString().split("T")[0]
  }
  if (typeof date === "string") {
    // If already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
    return new Date(date).toISOString().split("T")[0]
  }
  return date.toISOString().split("T")[0]
}

export interface ServiceOptions {
  config?: AirtableConfig
  fetchFn?: typeof fetch
}

/**
 * Creates a new job application record in Airtable.
 */
export async function createJobRecord(
  input: CreateJobInput,
  options?: ServiceOptions
): Promise<AirtableRecord> {
  const company = input.company?.trim()
  const jobTitle = input.jobTitle?.trim()

  if (!company) {
    throw new AirtableIntegrationError(
      "Cannot create job record: 'company' is required.",
      "INVALID_FIELD"
    )
  }
  if (!jobTitle) {
    throw new AirtableIntegrationError(
      "Cannot create job record: 'jobTitle' is required.",
      "INVALID_FIELD"
    )
  }

  const name = `${company} - ${jobTitle}`
  const status: JobStatus = input.status ?? "Discovered"
  const dateDiscovered = input.dateDiscovered ?? formatDate()

  const fields: Partial<JobApplicationFields> = {
    Name: name,
    Company: company,
    "Job Title": jobTitle,
    Status: status,
    "Date Discovered": dateDiscovered,
  }

  if (input.jobUrl?.trim()) fields["Job URL"] = input.jobUrl.trim()
  if (input.source?.trim()) fields.Source = input.source.trim()
  if (input.location?.trim()) fields.Location = input.location.trim()
  if (input.salary?.trim()) fields.Salary = input.salary.trim()
  if (input.dateApplied) fields["Date Applied"] = formatDate(input.dateApplied)
  if (input.resumeVersion?.trim())
    fields["Resume Version"] = input.resumeVersion.trim()
  if (input.followUpDate)
    fields["Follow-up Date"] = formatDate(input.followUpDate)
  if (input.nextAction?.trim()) fields["Next Action"] = input.nextAction.trim()
  if (input.submissionEvidence?.trim())
    fields["Submission Evidence"] = input.submissionEvidence.trim()
  if (input.notes?.trim()) fields.Notes = input.notes.trim()
  if (input.navixRunId?.trim())
    fields["Navix Run ID"] = input.navixRunId.trim()

  const response = await airtableFetch<AirtableRecord>({
    method: "POST",
    body: { fields },
    config: options?.config,
    fetchFn: options?.fetchFn,
  })

  setCachedRecord(response)
  return response
}

/**
 * Retrieves a single job record by its Airtable record ID.
 */
export async function getJobRecord(
  recordId: string,
  options?: ServiceOptions
): Promise<AirtableRecord | null> {
  if (!recordId) return null

  const cached = getCachedRecord(recordId)
  if (cached) return cached

  try {
    const response = await airtableFetch<AirtableRecord>({
      method: "GET",
      path: `/${recordId}`,
      config: options?.config,
      fetchFn: options?.fetchFn,
    })
    setCachedRecord(response)
    return response
  } catch (err) {
    if (
      err instanceof AirtableIntegrationError &&
      err.code === "NOT_FOUND"
    ) {
      return null
    }
    throw err
  }
}

/**
 * Searches for an existing job record using URL matching first,
 * with fallback to fuzzy company + job title matching.
 */
export async function findExistingJob(
  query: FindJobQuery,
  options?: ServiceOptions
): Promise<AirtableRecord | null> {
  const targetUrlNormalized = normalizeUrl(query.jobUrl)
  const targetCompanyNorm = normalizeText(query.company)
  const targetTitleNorm = normalizeText(query.jobTitle)

  if (!targetUrlNormalized && (!targetCompanyNorm || !targetTitleNorm)) {
    return null
  }

  // 1. Primary lookup by URL if available
  if (targetUrlNormalized) {
    const allWithUrls = await listJobRecords(
      { limit: 100 },
      options
    )

    const urlMatch = allWithUrls.find((rec) => {
      const recordUrl = rec.fields["Job URL"]
      return recordUrl && normalizeUrl(recordUrl) === targetUrlNormalized
    })

    if (urlMatch) {
      setCachedRecord(urlMatch)
      return urlMatch
    }
  }

  // 2. Secondary fallback by normalized Company & Job Title
  if (targetCompanyNorm && targetTitleNorm) {
    const companyRecords = await listJobRecords(
      {
        company: query.company,
        limit: 100,
      },
      options
    )

    const textMatch = companyRecords.find((rec) => {
      const recCompanyNorm = normalizeText(rec.fields.Company)
      const recTitleNorm = normalizeText(rec.fields["Job Title"])
      return (
        recCompanyNorm === targetCompanyNorm &&
        recTitleNorm === targetTitleNorm
      )
    })

    if (textMatch) {
      setCachedRecord(textMatch)
      return textMatch
    }
  }

  return null
}

/**
 * Updates an existing job record without erasing non-empty fields.
 */
export async function updateJobRecord(
  recordId: string,
  updates: UpdateJobInput,
  options?: ServiceOptions & { preserveExistingNotes?: boolean }
): Promise<AirtableRecord> {
  if (!recordId) {
    throw new AirtableIntegrationError(
      "Cannot update job record: recordId is missing.",
      "INVALID_FIELD"
    )
  }

  const existing = await getJobRecord(recordId, options)
  const fields: Partial<JobApplicationFields> = {}

  if (updates.company !== undefined && updates.company.trim() !== "") {
    fields.Company = updates.company.trim()
  }
  if (updates.jobTitle !== undefined && updates.jobTitle.trim() !== "") {
    fields["Job Title"] = updates.jobTitle.trim()
  }

  // Update primary Name if company or title changed
  const effectiveCompany =
    fields.Company || existing?.fields.Company || ""
  const effectiveTitle =
    fields["Job Title"] || existing?.fields["Job Title"] || ""
  if (effectiveCompany && effectiveTitle) {
    fields.Name = `${effectiveCompany} - ${effectiveTitle}`
  }

  if (updates.jobUrl !== undefined && updates.jobUrl.trim() !== "") {
    fields["Job URL"] = updates.jobUrl.trim()
  }
  if (updates.source !== undefined && updates.source.trim() !== "") {
    fields.Source = updates.source.trim()
  }
  if (updates.location !== undefined && updates.location.trim() !== "") {
    fields.Location = updates.location.trim()
  }
  if (updates.salary !== undefined && updates.salary.trim() !== "") {
    fields.Salary = updates.salary.trim()
  }
  if (updates.status !== undefined) {
    fields.Status = updates.status
  }
  if (updates.dateDiscovered !== undefined && updates.dateDiscovered !== "") {
    fields["Date Discovered"] = formatDate(updates.dateDiscovered)
  }
  if (updates.dateApplied !== undefined && updates.dateApplied !== "") {
    fields["Date Applied"] = formatDate(updates.dateApplied)
  }
  if (
    updates.resumeVersion !== undefined &&
    updates.resumeVersion.trim() !== ""
  ) {
    fields["Resume Version"] = updates.resumeVersion.trim()
  }
  if (updates.followUpDate !== undefined && updates.followUpDate !== "") {
    fields["Follow-up Date"] = formatDate(updates.followUpDate)
  }
  if (updates.nextAction !== undefined && updates.nextAction.trim() !== "") {
    fields["Next Action"] = updates.nextAction.trim()
  }
  if (
    updates.submissionEvidence !== undefined &&
    updates.submissionEvidence.trim() !== ""
  ) {
    fields["Submission Evidence"] = updates.submissionEvidence.trim()
  }
  if (updates.navixRunId !== undefined && updates.navixRunId.trim() !== "") {
    fields["Navix Run ID"] = updates.navixRunId.trim()
  }

  // Preserve and append notes if requested
  if (updates.notes !== undefined && updates.notes.trim() !== "") {
    const newNote = updates.notes.trim()
    if (
      options?.preserveExistingNotes !== false &&
      existing?.fields.Notes?.trim()
    ) {
      fields.Notes = `${existing.fields.Notes.trim()}\n\n---\n${newNote}`
    } else {
      fields.Notes = newNote
    }
  }

  const response = await airtableFetch<AirtableRecord>({
    method: "PATCH",
    path: `/${recordId}`,
    body: { fields },
    config: options?.config,
    fetchFn: options?.fetchFn,
  })

  setCachedRecord(response)
  return response
}

/**
 * Lists job records with optional filtering and pagination.
 */
export async function listJobRecords(
  filter?: ListJobFilter,
  options?: ServiceOptions
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = []
  let offset: string | undefined = undefined
  const maxRecords = filter?.limit ?? 100

  // Build formula parts if filters are provided
  const formulaParts: string[] = []

  if (filter?.status) {
    if (Array.isArray(filter.status)) {
      const orParts = filter.status.map(
        (s) => `{Status} = '${s.replace(/'/g, "\\'")}'`
      )
      formulaParts.push(`OR(${orParts.join(", ")})`)
    } else {
      formulaParts.push(
        `{Status} = '${filter.status.replace(/'/g, "\\'")}'`
      )
    }
  }

  if (filter?.company?.trim()) {
    formulaParts.push(
      `FIND(LOWER('${filter.company.trim().replace(/'/g, "\\'")}'), LOWER({Company})) > 0`
    )
  }

  if (filter?.followUpBeforeOrOn) {
    const targetDate = formatDate(filter.followUpBeforeOrOn)
    formulaParts.push(
      `AND({Follow-up Date} != '', IS_BEFORE({Follow-up Date}, DATEADD('${targetDate}', 1, 'days')))`
    )
  }

  if (filter?.appliedAfterOrOn) {
    const targetDate = formatDate(filter.appliedAfterOrOn)
    formulaParts.push(
      `AND({Date Applied} != '', NOT(IS_BEFORE({Date Applied}, '${targetDate}')))`
    )
  }

  const filterByFormula =
    formulaParts.length > 1
      ? `AND(${formulaParts.join(", ")})`
      : formulaParts[0]

  do {
    const params: Record<string, string | number | undefined> = {
      pageSize: Math.min(maxRecords - records.length, 100),
    }
    if (filterByFormula) params.filterByFormula = filterByFormula
    if (offset) params.offset = offset

    const data = await airtableFetch<{
      records: AirtableRecord[]
      offset?: string
    }>({
      method: "GET",
      params,
      config: options?.config,
      fetchFn: options?.fetchFn,
    })

    if (data.records && Array.isArray(data.records)) {
      for (const rec of data.records) {
        records.push(rec)
        setCachedRecord(rec)
        if (records.length >= maxRecords) break
      }
    }

    offset = data.offset
  } while (offset && records.length < maxRecords)

  return records
}

/**
 * Lists all active applications due for follow-up on or before the given date.
 */
export async function listJobsNeedingFollowUp(
  asOfDate?: string,
  options?: ServiceOptions
): Promise<AirtableRecord[]> {
  const targetDate = formatDate(asOfDate)

  // Query jobs that have a Follow-up Date set
  const allRecords = await listJobRecords(
    {
      limit: 100,
    },
    options
  )

  return allRecords.filter((rec) => {
    const fDate = rec.fields["Follow-up Date"]
    const status = rec.fields.Status
    if (!fDate) return false

    // Only active applications need follow-up
    const activeStatuses: JobStatus[] = [
      "Applied",
      "Assessment",
      "Interview",
      "Application Attempted",
    ]
    if (!activeStatuses.includes(status)) return false

    return fDate <= targetDate
  })
}

/**
 * Handles job discovery: checks Airtable first. If new, saves with Discovered status.
 * If already exists, updates missing fields without overwriting user data.
 */
export async function saveDiscoveredJob(
  input: CreateJobInput,
  options?: ServiceOptions
): Promise<{ record: AirtableRecord; isNew: boolean }> {
  const existing = await findExistingJob(
    {
      jobUrl: input.jobUrl,
      company: input.company,
      jobTitle: input.jobTitle,
    },
    options
  )

  if (!existing) {
    const created = await createJobRecord(
      {
        ...input,
        status: input.status ?? "Discovered",
        dateDiscovered: input.dateDiscovered ?? formatDate(),
      },
      options
    )
    return { record: created, isNew: true }
  }

  // Update only missing fields on existing record
  const updates: UpdateJobInput = {}
  if (!existing.fields["Job URL"] && input.jobUrl?.trim()) {
    updates.jobUrl = input.jobUrl.trim()
  }
  if (!existing.fields.Location && input.location?.trim()) {
    updates.location = input.location.trim()
  }
  if (!existing.fields.Salary && input.salary?.trim()) {
    updates.salary = input.salary.trim()
  }
  if (!existing.fields.Source && input.source?.trim()) {
    updates.source = input.source.trim()
  }
  if (input.notes?.trim()) {
    // Append research notes without overwriting
    updates.notes = input.notes.trim()
  }

  const updated = Object.keys(updates).length > 0
    ? await updateJobRecord(existing.id, updates, options)
    : existing

  return { record: updated, isNew: false }
}

/**
 * Records an application attempt.
 * Prevents accidental repeated submissions for jobs already confirmed as Applied.
 */
export async function recordApplicationAttempt(
  params: {
    company: string
    jobTitle: string
    jobUrl?: string
    navixRunId?: string
    notes?: string
    resumeVersion?: string
  },
  options?: ServiceOptions
): Promise<AirtableRecord> {
  const existing = await findExistingJob(
    {
      jobUrl: params.jobUrl,
      company: params.company,
      jobTitle: params.jobTitle,
    },
    options
  )

  if (existing) {
    if (existing.fields.Status === "Applied") {
      throw new AirtableIntegrationError(
        `Application blocked: Already confirmed as Applied to '${existing.fields.Company} - ${existing.fields["Job Title"]}' on ${existing.fields["Date Applied"] || "a prior date"}. Accidental duplicate submission prevented.`,
        "DUPLICATE_APPLICATION"
      )
    }

    return await updateJobRecord(
      existing.id,
      {
        status: "Application Attempted",
        navixRunId: params.navixRunId,
        resumeVersion: params.resumeVersion,
        notes: `Application attempt initiated via Navix Run ${params.navixRunId || "unknown"}.${params.notes ? ` Note: ${params.notes}` : ""}`,
      },
      options
    )
  }

  return await createJobRecord(
    {
      company: params.company,
      jobTitle: params.jobTitle,
      jobUrl: params.jobUrl,
      status: "Application Attempted",
      navixRunId: params.navixRunId,
      resumeVersion: params.resumeVersion,
      notes: `Application attempt initiated via Navix Run ${params.navixRunId || "unknown"}.${params.notes ? ` Note: ${params.notes}` : ""}`,
    },
    options
  )
}

/**
 * Confirms an application outcome.
 * CRITICAL RULE: Sets 'Applied' ONLY when reliable evidence supports successful submission.
 * Otherwise sets 'Application Attempted'.
 * Retains error information if Airtable sync fails so application attempt isn't rerun.
 */
export async function confirmApplication(
  params: {
    company: string
    jobTitle: string
    jobUrl?: string
    evidence: string
    isVerified: boolean
    dateApplied?: string
    navixRunId?: string
    resumeVersion?: string
    followUpDate?: string
    notes?: string
  },
  options?: ServiceOptions
): Promise<{
  success: boolean
  record?: AirtableRecord
  statusAssigned: JobStatus
  syncError?: string
}> {
  const statusToAssign: JobStatus = params.isVerified && params.evidence?.trim()
    ? "Applied"
    : "Application Attempted"

  const defaultFollowUp =
    params.followUpDate ||
    (() => {
      const d = new Date()
      d.setDate(d.getDate() + 7) // Default 7 days follow-up
      return formatDate(d)
    })()

  try {
    const existing = await findExistingJob(
      {
        jobUrl: params.jobUrl,
        company: params.company,
        jobTitle: params.jobTitle,
      },
      options
    )

    let record: AirtableRecord
    if (existing) {
      record = await updateJobRecord(
        existing.id,
        {
          status: statusToAssign,
          dateApplied: statusToAssign === "Applied" ? formatDate(params.dateApplied) : undefined,
          submissionEvidence: params.evidence?.trim() || "No submission proof recorded.",
          navixRunId: params.navixRunId,
          resumeVersion: params.resumeVersion,
          followUpDate: statusToAssign === "Applied" ? defaultFollowUp : undefined,
          nextAction: statusToAssign === "Applied" ? "Follow up with recruiter" : "Review application attempt",
          notes: params.notes,
        },
        options
      )
    } else {
      record = await createJobRecord(
        {
          company: params.company,
          jobTitle: params.jobTitle,
          jobUrl: params.jobUrl,
          status: statusToAssign,
          dateApplied: statusToAssign === "Applied" ? formatDate(params.dateApplied) : undefined,
          submissionEvidence: params.evidence?.trim() || "No submission proof recorded.",
          navixRunId: params.navixRunId,
          resumeVersion: params.resumeVersion,
          followUpDate: statusToAssign === "Applied" ? defaultFollowUp : undefined,
          nextAction: statusToAssign === "Applied" ? "Follow up with recruiter" : "Review application attempt",
          notes: params.notes,
        },
        options
      )
    }

    return {
      success: true,
      record,
      statusAssigned: statusToAssign,
    }
  } catch (syncErr) {
    const errorMsg =
      syncErr instanceof Error ? syncErr.message : String(syncErr)
    return {
      success: false,
      statusAssigned: statusToAssign,
      syncError: `Application completed but Airtable sync failed: ${errorMsg}`,
    }
  }
}

// ── Query / Question Answering Helpers ─────────────────────────────────────

export async function getDiscoveredUnappliedJobs(
  options?: ServiceOptions
): Promise<AirtableRecord[]> {
  return listJobRecords(
    { status: ["Discovered", "To Research", "Ready to Apply"] },
    options
  )
}

export async function hasAppliedTo(
  company: string,
  jobTitle?: string,
  jobUrl?: string,
  options?: ServiceOptions
): Promise<{ applied: boolean; record: AirtableRecord | null }> {
  const existing = await findExistingJob(
    { company, jobTitle, jobUrl },
    options
  )
  if (!existing) return { applied: false, record: null }
  const isApplied =
    existing.fields.Status === "Applied" ||
    existing.fields.Status === "Interview" ||
    existing.fields.Status === "Assessment" ||
    existing.fields.Status === "Offer"

  return { applied: isApplied, record: existing }
}

export async function getAwaitingResponseJobs(
  options?: ServiceOptions
): Promise<AirtableRecord[]> {
  return listJobRecords({ status: "Applied" }, options)
}

export async function getUpcomingInterviewsAndAssessments(
  options?: ServiceOptions
): Promise<AirtableRecord[]> {
  return listJobRecords(
    { status: ["Interview", "Assessment"] },
    options
  )
}

export async function getMonthlyApplicationCount(
  yearMonth?: string,
  options?: ServiceOptions
): Promise<{ count: number; jobs: AirtableRecord[] }> {
  const target = yearMonth || formatDate().substring(0, 7) // YYYY-MM
  const allRecords = await listJobRecords({ limit: 200 }, options)

  const matching = allRecords.filter((rec) => {
    const applied = rec.fields["Date Applied"]
    return applied && applied.startsWith(target)
  })

  return {
    count: matching.length,
    jobs: matching,
  }
}

export async function getLastApplicationAttempt(
  options?: ServiceOptions
): Promise<AirtableRecord | null> {
  const records = await listJobRecords(
    {
      status: ["Application Attempted", "Applied"],
      limit: 50,
    },
    options
  )

  if (records.length === 0) return null

  // Sort by createdTime or Date Applied descending
  records.sort((a, b) => {
    const dateA = a.fields["Date Applied"] || a.createdTime
    const dateB = b.fields["Date Applied"] || b.createdTime
    return dateB.localeCompare(dateA)
  })

  return records[0]
}

export async function getJobSearchOverview(options?: ServiceOptions) {
  const [discovered, awaiting, followUps, interviews, monthly, lastAttempt] =
    await Promise.all([
      getDiscoveredUnappliedJobs(options),
      getAwaitingResponseJobs(options),
      listJobsNeedingFollowUp(undefined, options),
      getUpcomingInterviewsAndAssessments(options),
      getMonthlyApplicationCount(undefined, options),
      getLastApplicationAttempt(options),
    ])

  return {
    discoveredUnappliedCount: discovered.length,
    discoveredJobs: discovered.map((j) => ({
      name: j.fields.Name,
      company: j.fields.Company,
      status: j.fields.Status,
      url: j.fields["Job URL"],
    })),
    awaitingResponseCount: awaiting.length,
    awaitingJobs: awaiting.map((j) => ({
      name: j.fields.Name,
      dateApplied: j.fields["Date Applied"],
      followUpDate: j.fields["Follow-up Date"],
    })),
    needingFollowUpCount: followUps.length,
    needingFollowUpJobs: followUps.map((j) => ({
      name: j.fields.Name,
      followUpDate: j.fields["Follow-up Date"],
      status: j.fields.Status,
    })),
    upcomingInterviewsAndAssessmentsCount: interviews.length,
    interviews: interviews.map((j) => ({
      name: j.fields.Name,
      status: j.fields.Status,
      nextAction: j.fields["Next Action"],
    })),
    submittedThisMonth: monthly.count,
    lastApplicationAttempt: lastAttempt
      ? {
          name: lastAttempt.fields.Name,
          status: lastAttempt.fields.Status,
          dateApplied: lastAttempt.fields["Date Applied"],
          evidence: lastAttempt.fields["Submission Evidence"],
          runId: lastAttempt.fields["Navix Run ID"],
        }
      : null,
  }
}
