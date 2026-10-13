export const JOB_STATUSES = [
  "Discovered",
  "To Research",
  "Ready to Apply",
  "Application Attempted",
  "Applied",
  "Assessment",
  "Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

export interface JobApplicationFields {
  Name: string
  Company: string
  "Job Title": string
  "Job URL"?: string
  Source?: string
  Location?: string
  Salary?: string
  Status: JobStatus
  "Date Discovered"?: string
  "Date Applied"?: string
  "Resume Version"?: string
  "Follow-up Date"?: string
  "Next Action"?: string
  "Submission Evidence"?: string
  Notes?: string
  "Navix Run ID"?: string
}

export interface AirtableRecord<T = JobApplicationFields> {
  id: string
  createdTime: string
  fields: T
}

export interface CreateJobInput {
  company: string
  jobTitle: string
  jobUrl?: string
  source?: string
  location?: string
  salary?: string
  status?: JobStatus
  dateDiscovered?: string
  dateApplied?: string
  resumeVersion?: string
  followUpDate?: string
  nextAction?: string
  submissionEvidence?: string
  notes?: string
  navixRunId?: string
}

export interface UpdateJobInput {
  name?: string
  company?: string
  jobTitle?: string
  jobUrl?: string
  source?: string
  location?: string
  salary?: string
  status?: JobStatus
  dateDiscovered?: string
  dateApplied?: string
  resumeVersion?: string
  followUpDate?: string
  nextAction?: string
  submissionEvidence?: string
  notes?: string
  navixRunId?: string
}

export interface FindJobQuery {
  jobUrl?: string
  company?: string
  jobTitle?: string
}

export interface ListJobFilter {
  status?: JobStatus | JobStatus[]
  company?: string
  followUpBeforeOrOn?: string
  appliedAfterOrOn?: string
  limit?: number
}

export type AirtableErrorCode =
  | "CONFIG_MISSING"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INVALID_FIELD"
  | "DUPLICATE_APPLICATION"
  | "UNVERIFIED_SUBMISSION"
  | "API_ERROR"

export class AirtableIntegrationError extends Error {
  public readonly code: AirtableErrorCode
  public readonly statusCode?: number
  public readonly details?: unknown

  constructor(
    message: string,
    code: AirtableErrorCode,
    statusCode?: number,
    details?: unknown
  ) {
    super(message)
    this.name = "AirtableIntegrationError"
    this.code = code
    this.statusCode = statusCode
    this.details = details
    Object.setPrototypeOf(this, AirtableIntegrationError.prototype)
  }
}

export interface AirtableConfig {
  personalAccessToken: string
  baseId: string
  tableName: string
}
