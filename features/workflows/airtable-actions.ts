"use server"

import {
  getAwaitingResponseJobs,
  getDiscoveredUnappliedJobs,
  getJobSearchOverview,
  getLastApplicationAttempt,
  getMonthlyApplicationCount,
  getUpcomingInterviewsAndAssessments,
  hasAppliedTo,
  isAirtableConfigured,
  listJobsNeedingFollowUp,
  AirtableIntegrationError,
} from "@/lib/airtable"

export async function checkAirtableConfiguredAction() {
  return { configured: isAirtableConfigured() }
}

export async function getDiscoveredJobsAction() {
  if (!isAirtableConfigured()) {
    return { error: "Airtable is not configured", jobs: [] }
  }
  try {
    const records = await getDiscoveredUnappliedJobs()
    return {
      jobs: records.map((r) => ({
        id: r.id,
        name: r.fields.Name,
        company: r.fields.Company,
        jobTitle: r.fields["Job Title"],
        jobUrl: r.fields["Job URL"],
        status: r.fields.Status,
        dateDiscovered: r.fields["Date Discovered"],
      })),
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      jobs: [],
    }
  }
}

export async function checkHasAppliedAction({
  company,
  jobTitle,
  jobUrl,
}: {
  company: string
  jobTitle?: string
  jobUrl?: string
}) {
  if (!isAirtableConfigured()) {
    return { error: "Airtable is not configured", applied: false, record: null }
  }
  try {
    const result = await hasAppliedTo(company, jobTitle, jobUrl)
    return {
      applied: result.applied,
      record: result.record
        ? {
            id: result.record.id,
            name: result.record.fields.Name,
            status: result.record.fields.Status,
            dateApplied: result.record.fields["Date Applied"],
            evidence: result.record.fields["Submission Evidence"],
          }
        : null,
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      applied: false,
      record: null,
    }
  }
}

export async function getAwaitingResponseJobsAction() {
  if (!isAirtableConfigured()) {
    return { error: "Airtable is not configured", jobs: [] }
  }
  try {
    const records = await getAwaitingResponseJobs()
    return {
      jobs: records.map((r) => ({
        id: r.id,
        name: r.fields.Name,
        company: r.fields.Company,
        jobTitle: r.fields["Job Title"],
        dateApplied: r.fields["Date Applied"],
        followUpDate: r.fields["Follow-up Date"],
        status: r.fields.Status,
      })),
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      jobs: [],
    }
  }
}

export async function getFollowUpJobsAction() {
  if (!isAirtableConfigured()) {
    return { error: "Airtable is not configured", jobs: [] }
  }
  try {
    const records = await listJobsNeedingFollowUp()
    return {
      jobs: records.map((r) => ({
        id: r.id,
        name: r.fields.Name,
        company: r.fields.Company,
        status: r.fields.Status,
        followUpDate: r.fields["Follow-up Date"],
        nextAction: r.fields["Next Action"],
      })),
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      jobs: [],
    }
  }
}

export async function getUpcomingInterviewsAction() {
  if (!isAirtableConfigured()) {
    return { error: "Airtable is not configured", jobs: [] }
  }
  try {
    const records = await getUpcomingInterviewsAndAssessments()
    return {
      jobs: records.map((r) => ({
        id: r.id,
        name: r.fields.Name,
        company: r.fields.Company,
        status: r.fields.Status,
        nextAction: r.fields["Next Action"],
        notes: r.fields.Notes,
      })),
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      jobs: [],
    }
  }
}

export async function getMonthlySubmissionCountAction() {
  if (!isAirtableConfigured()) {
    return { error: "Airtable is not configured", count: 0, jobs: [] }
  }
  try {
    const result = await getMonthlyApplicationCount()
    return {
      count: result.count,
      jobs: result.jobs.map((r) => ({
        id: r.id,
        name: r.fields.Name,
        dateApplied: r.fields["Date Applied"],
      })),
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      count: 0,
      jobs: [],
    }
  }
}

export async function getLastApplicationAttemptAction() {
  if (!isAirtableConfigured()) {
    return { error: "Airtable is not configured", lastAttempt: null }
  }
  try {
    const record = await getLastApplicationAttempt()
    return {
      lastAttempt: record
        ? {
            id: record.id,
            name: record.fields.Name,
            status: record.fields.Status,
            dateApplied: record.fields["Date Applied"],
            submissionEvidence: record.fields["Submission Evidence"],
            navixRunId: record.fields["Navix Run ID"],
            notes: record.fields.Notes,
          }
        : null,
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      lastAttempt: null,
    }
  }
}

export async function getJobSearchOverviewAction() {
  if (!isAirtableConfigured()) {
    return {
      error: "Airtable is not configured",
      overview: null,
    }
  }
  try {
    const overview = await getJobSearchOverview()
    return { overview }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      overview: null,
    }
  }
}
