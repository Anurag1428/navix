export type EnrichmentProvider = "apollo" | "none"

export type ApolloErrorCode =
  | "CONFIG_MISSING"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "API_ERROR"
  | "INVALID_INPUT"

export class ApolloEnrichmentError extends Error {
  public readonly code: ApolloErrorCode
  public readonly statusCode?: number
  public readonly details?: unknown

  constructor(
    message: string,
    code: ApolloErrorCode,
    statusCode?: number,
    details?: unknown
  ) {
    super(message)
    this.name = "ApolloEnrichmentError"
    this.code = code
    this.statusCode = statusCode
    this.details = details
    Object.setPrototypeOf(this, ApolloEnrichmentError.prototype)
  }
}

export interface ExecutiveSearchOptions {
  domain?: string
  companyName?: string
  priorityTitles?: string[]
  apiKey?: string
  fetchFn?: typeof fetch
  maxRetries?: number
  baseDelayMs?: number
}

export interface EnrichedExecutive {
  name: string
  firstName: string
  title: string
  email: string
  emailConfidence: number // 0 to 100 percentage
  linkedinUrl?: string
  companyDomain: string
  provider: EnrichmentProvider
}

export interface ApolloPerson {
  id: string
  first_name?: string
  last_name?: string
  name?: string
  title?: string
  email?: string
  email_status?: string
  linkedin_url?: string
  organization?: {
    id?: string
    name?: string
    primary_domain?: string
  }
}

export interface ApolloSearchResponse {
  people?: ApolloPerson[]
  pagination?: {
    page: number
    per_page: number
    total_entries: number
    total_pages: number
  }
  error?: string
  message?: string
}
