import {
  confirmApplication,
  findExistingJob,
  hasAppliedTo,
  isAirtableConfigured,
  listJobsNeedingFollowUp,
  recordApplicationAttempt,
  saveDiscoveredJob,
  updateJobRecord,
  AirtableIntegrationError,
  type JobStatus,
} from "../../../lib/airtable/index.ts"
import {
  extractJobsFromContext,
  isGenericSearchUrl,
  type ExtractedJobItem,
} from "../../../lib/airtable/workflow-sync.ts"
import type { StepNodeType } from "@/features/workflows/nodes/node-registry"
import type { RunStep } from "@/features/workflows/tasks/run-workflow"

export interface AirtableNodeParams {
  values: Record<string, string>
  nodeId?: string
  outputs?: Record<string, unknown>
  nodes?: StepNodeType[]
  edges?: { source: string; target: string }[]
  steps?: RunStep[]
}

export interface AirtableNodeResult {
  success: boolean
  operation: string
  recordId?: string
  status?: string
  isNew?: string
  alreadyApplied?: string
  summary: string
  error?: string
}

export async function airtableNode({
  values,
  nodeId,
  outputs,
  nodes,
  edges,
  steps,
}: AirtableNodeParams): Promise<AirtableNodeResult> {
  let operation = (values.operation || "").trim().toLowerCase()
  let company: string | undefined = values.company?.trim()
  let jobTitle: string | undefined = values.jobTitle?.trim()
  let jobUrl: string | undefined = values.jobUrl?.trim()
  if (jobUrl && isGenericSearchUrl(jobUrl)) {
    jobUrl = undefined
  }
  const statusInput = values.status?.trim() as JobStatus | undefined
  let evidence: string | undefined = values.evidence?.trim()
  const notes = values.notes?.trim()
  const source = values.source?.trim()
  const location = values.location?.trim()
  const salary = values.salary?.trim()
  const resumeVersion = values.resumeVersion?.trim()
  const navixRunId = values.navixRunId?.trim() || nodeId

  console.log(`[Airtable Node] START (nodeId: ${nodeId || "unknown"}, raw operation: "${operation}")`)

  if (!isAirtableConfigured()) {
    throw new AirtableIntegrationError(
      "Airtable integration is not configured. Please set AIRTABLE_PERSONAL_ACCESS_TOKEN and AIRTABLE_BASE_ID in your environment variables.",
      "CONFIG_MISSING"
    )
  }

  // 1. Identify target jobs: explicit inputs or auto-inferred from upstream context
  let targetJobs: ExtractedJobItem[] = []

  if (company && jobTitle) {
    targetJobs = [
      {
        company,
        jobTitle,
        jobUrl,
        status: statusInput,
        evidence,
        notes,
        source,
        location,
        salary,
      },
    ]
  } else {
    // Attempt automatic extraction from upstream agent/extract outputs and workflow steps
    const inferred = extractJobsFromContext({ steps, outputs })
    if (inferred.length > 0) {
      targetJobs = inferred
      console.log(
        `[Airtable Node] Auto-inferred ${inferred.length} job(s) from workflow context:`,
        inferred.map((j) => `${j.company} - ${j.jobTitle}`)
      )
      if (!company) company = inferred[0].company
      if (!jobTitle) jobTitle = inferred[0].jobTitle
      if (!jobUrl) jobUrl = inferred[0].jobUrl
      if (!evidence && inferred[0].evidence) evidence = inferred[0].evidence
    }
  }

  // 2. Resolve operation:
  // If operation was left empty or set to "auto":
  // Route to confirm-application if any job was verified/Applied, or record-attempt if attempted, else save-discovered
  if (!operation || operation === "auto") {
    if (targetJobs.length > 0 && targetJobs.some((j) => j.status === "Applied")) {
      operation = "confirm-application"
    } else if (targetJobs.length > 0 && targetJobs.some((j) => j.status === "Application Attempted")) {
      operation = "record-attempt"
    } else {
      operation = "save-discovered"
    }
  } else if (
    operation === "save-discovered" &&
    !values.company &&
    targetJobs.length > 0 &&
    targetJobs.some((j) => j.status === "Applied")
  ) {
    operation = "confirm-application"
  } else if (
    operation === "save-discovered" &&
    !values.company &&
    targetJobs.length > 0 &&
    targetJobs.some((j) => j.status === "Application Attempted")
  ) {
    operation = "record-attempt"
  }

  // If no jobs could be found and the operation is not follow-ups, handle gracefully
  if (targetJobs.length === 0 && operation !== "list-followups" && operation !== "followups") {
    console.warn("[Airtable Node] No company or job details found in inputs or upstream outputs.")
    return {
      success: false,
      operation: operation || "save-discovered",
      summary: "Airtable Node: No company or job details could be inferred from upstream steps. Step skipped without failing workflow.",
      error: `Airtable Node (${operation || "save-discovered"}): 'company' is required and could not be inferred.`,
    }
  }

  // 1. OPERATION: save-discovered
  if (operation === "save-discovered" || operation === "discover") {
    const savedRecords = []
    for (const job of targetJobs) {
      const rawTargetUrl = job.jobUrl || jobUrl
      const effectiveUrl = isGenericSearchUrl(rawTargetUrl) ? undefined : rawTargetUrl
      try {
        const { record, isNew } = await saveDiscoveredJob({
          company: job.company,
          jobTitle: job.jobTitle,
          jobUrl: effectiveUrl,
          source: job.source || source,
          location: job.location || location,
          salary: job.salary || salary,
          status: statusInput || job.status || "Discovered",
          notes: job.notes || notes,
          resumeVersion,
          navixRunId,
        })
        savedRecords.push({ record, isNew })
      } catch (err) {
        console.warn(`[Airtable Node] Error saving discovered job '${job.company} - ${job.jobTitle}':`, err)
      }
    }

    if (savedRecords.length === 0) {
      return {
        success: false,
        operation: "save-discovered",
        summary: "Failed to save discovered jobs to Airtable.",
        error: "Airtable save failed",
      }
    }

    const first = savedRecords[0]
    const summary =
      savedRecords.length === 1
        ? first.isNew
          ? `Saved new discovered job: ${first.record.fields.Name} (Status: ${first.record.fields.Status})`
          : `Updated existing job: ${first.record.fields.Name} (Status: ${first.record.fields.Status})`
        : `Saved ${savedRecords.length} discovered job(s): ${savedRecords.map((s) => s.record.fields.Name).join(", ")}`

    return {
      success: true,
      operation: "save-discovered",
      recordId: savedRecords.map((s) => s.record.id).join(", "),
      status: first.record.fields.Status,
      isNew: savedRecords.some((s) => s.isNew) ? "true" : "false",
      summary,
    }
  }

  // 2. OPERATION: record-attempt
  if (operation === "record-attempt" || operation === "attempt") {
    const records = []
    for (const job of targetJobs) {
      const rawTargetUrl = job.jobUrl || jobUrl
      const effectiveUrl = isGenericSearchUrl(rawTargetUrl) ? undefined : rawTargetUrl
      const check = await hasAppliedTo(job.company, job.jobTitle, effectiveUrl)
      if (check.applied) {
        if (targetJobs.length === 1) {
          throw new AirtableIntegrationError(
            `Application submission blocked: Already confirmed applied to '${job.company} - ${job.jobTitle}'. Accidental duplicate submission prevented.`,
            "DUPLICATE_APPLICATION"
          )
        }
        console.warn(`[Airtable Node] Skipped attempt for '${job.company} - ${job.jobTitle}': Already Applied`)
        continue
      }

      const record = await recordApplicationAttempt({
        company: job.company,
        jobTitle: job.jobTitle,
        jobUrl: effectiveUrl,
        navixRunId,
        notes: job.notes || notes,
        resumeVersion,
      })
      records.push(record)
    }

    const primaryRecord = records[0]
    return {
      success: true,
      operation: "record-attempt",
      recordId: records.map((r) => r.id).join(", "),
      status: primaryRecord?.fields.Status || "Application Attempted",
      alreadyApplied: "false",
      summary:
        records.length === 1
          ? `Recorded application attempt for ${primaryRecord.fields.Name}. Status: Application Attempted`
          : `Recorded application attempts for ${records.length} job(s). Status: Application Attempted`,
    }
  }

  // 3. OPERATION: confirm-application
  if (operation === "confirm-application" || operation === "confirm") {
    const isExplicitlyVerified =
      values.isVerified === "true" ||
      values.isVerified === "yes" ||
      values.isVerified === "1"

    const results = []
    for (const job of targetJobs) {
      const rawTargetUrl = job.jobUrl || jobUrl
      const effectiveUrl = isGenericSearchUrl(rawTargetUrl) ? undefined : rawTargetUrl
      const jobEvidence = job.evidence || evidence
      const hasConcreteEvidence = Boolean(jobEvidence && jobEvidence.length > 5)
      const isVerified = isExplicitlyVerified || (job.isVerified ?? hasConcreteEvidence)

      const result = await confirmApplication({
        company: job.company,
        jobTitle: job.jobTitle,
        jobUrl: effectiveUrl,
        evidence: jobEvidence || "Application completed in workflow.",
        isVerified,
        navixRunId,
        resumeVersion,
        notes: job.notes || notes,
      })
      results.push({ job, result })
    }

    const successful = results.filter((r) => r.result.success)
    const recordIds = results.map((r) => r.result.record?.id).filter(Boolean)
    const primaryStatus = results[0]?.result.statusAssigned || "Applied"

    if (successful.length === 0 && results[0]?.result.syncError) {
      console.warn(`[Airtable Node] Sync warning: ${results[0].result.syncError}`)
      return {
        success: false,
        operation: "confirm-application",
        status: primaryStatus,
        summary: `Application marked as ${primaryStatus}, but Airtable sync failed: ${results[0].result.syncError}`,
        error: results[0].result.syncError,
      }
    }

    const summary =
      targetJobs.length === 1
        ? `Confirmed application for ${targetJobs[0].company} - ${targetJobs[0].jobTitle}. Status: ${primaryStatus}`
        : `Confirmed application for ${targetJobs.length} job(s): ${results.map((r) => `${r.job.company} - ${r.job.jobTitle} (${r.result.statusAssigned})`).join(", ")}`

    return {
      success: true,
      operation: "confirm-application",
      recordId: recordIds.join(", "),
      status: primaryStatus,
      summary,
    }
  }

  // 4. OPERATION: check-status / find
  if (operation === "check-status" || operation === "find") {
    const job = targetJobs[0]
    const targetComp = job?.company || company
    const targetTitle = job?.jobTitle || jobTitle
    const targetUrl = job?.jobUrl || jobUrl

    if (!targetComp && !targetUrl) {
      return {
        success: false,
        operation: "check-status",
        summary: "Airtable Node (check-status): 'company' or 'jobUrl' is required.",
        error: "Missing company or jobUrl",
      }
    }

    const match = await findExistingJob({ company: targetComp, jobTitle: targetTitle, jobUrl: targetUrl })
    const isAlreadyApplied =
      match?.fields.Status === "Applied" ||
      match?.fields.Status === "Interview" ||
      match?.fields.Status === "Offer"

    return {
      success: true,
      operation: "check-status",
      recordId: match?.id,
      status: match?.fields.Status,
      alreadyApplied: isAlreadyApplied ? "true" : "false",
      summary: match
        ? `Found existing application: ${match.fields.Name} (Status: ${match.fields.Status})`
        : `No matching application found for ${targetComp || targetUrl}.`,
    }
  }

  // 5. OPERATION: list-followups
  if (operation === "list-followups" || operation === "followups") {
    const followUps = await listJobsNeedingFollowUp()
    const summary = `Found ${followUps.length} application(s) needing follow-up.`

    return {
      success: true,
      operation: "list-followups",
      summary,
    }
  }

  // 6. OPERATION: update-status
  if (operation === "update-status") {
    const job = targetJobs[0]
    const targetComp = job?.company || company
    const targetTitle = job?.jobTitle || jobTitle
    const targetUrl = job?.jobUrl || jobUrl

    if (!targetComp) {
      return {
        success: false,
        operation: "update-status",
        summary: "Airtable Node (update-status): 'company' is required.",
        error: "Missing company",
      }
    }
    if (!statusInput) {
      return {
        success: false,
        operation: "update-status",
        summary: "Airtable Node (update-status): 'status' is required.",
        error: "Missing status",
      }
    }

    const existing = await findExistingJob({ company: targetComp, jobTitle: targetTitle, jobUrl: targetUrl })
    if (!existing) {
      return {
        success: false,
        operation: "update-status",
        summary: `Airtable Node: No existing record found for ${targetComp} - ${targetTitle || ""}`,
        error: "Record not found",
      }
    }

    const updated = await updateJobRecord(existing.id, {
      status: statusInput,
      notes,
    })

    return {
      success: true,
      operation: "update-status",
      recordId: updated.id,
      status: updated.fields.Status,
      summary: `Updated status for ${updated.fields.Name} to ${updated.fields.Status}.`,
    }
  }

  throw new Error(
    `Airtable Node: Unknown operation '${operation}'. Valid operations: save-discovered, record-attempt, confirm-application, check-status, update-status, list-followups.`
  )
}
