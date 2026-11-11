import { airtableFetch } from "./client.ts"
import { AirtableIntegrationError } from "./types.ts"
import type { AirtableConfig } from "./types.ts"
import type {
  CreateOutboundPitchInput,
  ListOutboundPitchesFilter,
  OutboundAirtableOptions,
  OutboundPitchFields,
  OutboundPitchRecord,
  OutboundPitchStatus,
} from "./outbound-types.ts"

const DEFAULT_OUTBOUND_TABLE_NAME = "Outbound Pitches"

/**
 * Normalizes a website URL or domain into a clean root domain string.
 * Example: "https://www.zepto.co.in/careers?ref=inc42#apply" -> "zepto.co.in"
 */
export function normalizeDomain(domain: string): string {
  if (!domain) return ""
  let clean = domain.trim().toLowerCase()
  clean = clean.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "")
  clean = clean.split("/")[0].split("?")[0].split("#")[0]
  return clean.trim()
}

/**
 * Formats a Date object or timestamp into an Airtable-compatible ISO YYYY-MM-DD string.
 */
export function formatAirtableDate(date: Date = new Date()): string {
  return date.toISOString().split("T")[0]
}

/**
 * Resolves the Airtable configuration for outbound pitches.
 * Prioritizes dedicated outbound environment variables before falling back to generic base credentials.
 */
export function getOutboundAirtableConfig(
  overrideConfig?: Partial<AirtableConfig>
): AirtableConfig {
  const personalAccessToken =
    overrideConfig?.personalAccessToken ||
    process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN?.trim()
  const baseId =
    overrideConfig?.baseId ||
    process.env.AIRTABLE_OUTBOUND_BASE_ID?.trim() ||
    process.env.AIRTABLE_BASE_ID?.trim()
  const tableName =
    overrideConfig?.tableName ||
    process.env.AIRTABLE_OUTBOUND_TABLE_NAME?.trim() ||
    DEFAULT_OUTBOUND_TABLE_NAME

  if (!personalAccessToken) {
    throw new AirtableIntegrationError(
      "Airtable configuration missing: 'AIRTABLE_PERSONAL_ACCESS_TOKEN' environment variable is required. " +
        "Generate a Personal Access Token at https://airtable.com/create/tokens with 'data.records:read' and 'data.records:write' scopes.",
      "CONFIG_MISSING"
    )
  }

  if (!baseId) {
    throw new AirtableIntegrationError(
      "Airtable configuration missing: 'AIRTABLE_OUTBOUND_BASE_ID' or 'AIRTABLE_BASE_ID' environment variable is required. " +
        "Provide your Airtable Base ID (starts with 'app...') in your environment.",
      "CONFIG_MISSING"
    )
  }

  return {
    personalAccessToken,
    baseId,
    tableName,
  }
}

/**
 * Checks whether an outbound pitch record for the target domain already exists in Airtable.
 * Used for pre-flight deduplication to avoid wasting B2B enrichment API credits.
 */
export async function checkDomainExists(
  domain: string,
  options?: OutboundAirtableOptions
): Promise<boolean> {
  const cleanDomain = normalizeDomain(domain)
  if (!cleanDomain) {
    return false
  }

  const config = getOutboundAirtableConfig(options?.config)
  // Airtable formula: FIND('domain', LOWER({Website / Domain})) > 0
  const escapedDomain = cleanDomain.replace(/'/g, "\\'")
  const filterByFormula = `FIND('${escapedDomain}', LOWER({Website / Domain})) > 0`

  const data = await airtableFetch<{ records: Array<{ id: string }> }>({
    method: "GET",
    config,
    fetchFn: options?.fetchFn,
    params: {
      filterByFormula,
      maxRecords: 1,
    },
  })

  return Boolean(data.records && data.records.length > 0)
}

/**
 * Inserts a newly enriched and synthesized lead pitch into the Outbound Pitches table.
 */
export async function createOutboundPitch(
  input: CreateOutboundPitchInput | OutboundPitchFields,
  options?: OutboundAirtableOptions
): Promise<OutboundPitchRecord> {
  const config = getOutboundAirtableConfig(options?.config)

  let fields: OutboundPitchFields

  if ("Company Name" in input) {
    fields = { ...input }
  } else {
    fields = {
      "Company Name": input.companyName,
      "Website / Domain":
        normalizeDomain(input.websiteOrDomain) || input.websiteOrDomain,
      "Funding Round": input.fundingRound,
      "Funding Amount": input.fundingAmount,
      "Lead Investors": input.leadInvestors,
      "Executive Name": input.executiveName,
      "Executive Title": input.executiveTitle,
      "Executive Email": input.executiveEmail,
      "Executive LinkedIn": input.executiveLinkedIn,
      "Email Confidence": input.emailConfidence,
      "Draft Subject": input.draftSubject,
      "Draft Body": input.draftBody,
      "Alternative Angles": input.alternativeAngles,
      "LinkedIn Note": input.linkedInNote,
      "Status": input.status || "Pending Review",
      "Staged Date": input.stagedDate || formatAirtableDate(),
      "Navix Run ID": input.navixRunId,
      "Notes": input.notes,
    }
  }

  if (!fields["Company Name"]?.trim()) {
    throw new AirtableIntegrationError(
      "Cannot create outbound pitch record: 'Company Name' is required.",
      "INVALID_FIELD"
    )
  }

  if (!fields["Website / Domain"]?.trim()) {
    throw new AirtableIntegrationError(
      "Cannot create outbound pitch record: 'Website / Domain' is required.",
      "INVALID_FIELD"
    )
  }

  if (!fields["Status"]) {
    fields["Status"] = "Pending Review"
  }

  if (!fields["Staged Date"]) {
    fields["Staged Date"] = formatAirtableDate()
  }

  // Sanitize undefined/null values
  const payloadFields: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined && val !== null && val !== "") {
      payloadFields[key] = val
    }
  }

  const response = await airtableFetch<OutboundPitchRecord>({
    method: "POST",
    config,
    fetchFn: options?.fetchFn,
    body: {
      fields: payloadFields,
      typecast: true,
    },
  })

  return response
}

/**
 * Lists outbound pitch records, optionally filtering by status or company name.
 */
export async function listOutboundPitches(
  filter?: ListOutboundPitchesFilter,
  options?: OutboundAirtableOptions
): Promise<OutboundPitchRecord[]> {
  const config = getOutboundAirtableConfig(options?.config)
  const params: Record<string, string | number | boolean | undefined> = {}

  const formulas: string[] = []

  if (filter?.status) {
    if (Array.isArray(filter.status)) {
      const orClauses = filter.status.map(
        (s) => `{Status} = '${s.replace(/'/g, "\\'")}'`
      )
      formulas.push(`OR(${orClauses.join(", ")})`)
    } else {
      formulas.push(`{Status} = '${filter.status.replace(/'/g, "\\'")}'`)
    }
  }

  if (filter?.companyName) {
    const escapedCompany = filter.companyName.trim().toLowerCase().replace(/'/g, "\\'")
    formulas.push(
      `FIND('${escapedCompany}', LOWER({Company Name})) > 0`
    )
  }

  if (formulas.length === 1) {
    params.filterByFormula = formulas[0]
  } else if (formulas.length > 1) {
    params.filterByFormula = `AND(${formulas.join(", ")})`
  }

  if (filter?.limit) {
    params.maxRecords = filter.limit
  }

  const data = await airtableFetch<{ records: OutboundPitchRecord[] }>({
    method: "GET",
    config,
    fetchFn: options?.fetchFn,
    params,
  })

  return data.records || []
}

/**
 * Updates the status of an outbound pitch (e.g., from 'Pending Review' to 'Approved' or 'Rejected').
 */
export async function updateOutboundPitchStatus(
  recordId: string,
  status: OutboundPitchStatus,
  options?: {
    notes?: string
    config?: AirtableConfig
    fetchFn?: typeof fetch
  }
): Promise<OutboundPitchRecord> {
  if (!recordId?.trim()) {
    throw new AirtableIntegrationError(
      "Cannot update outbound pitch: 'recordId' is required.",
      "INVALID_FIELD"
    )
  }

  const config = getOutboundAirtableConfig(options?.config)
  const fields: Record<string, unknown> = { Status: status }
  if (options?.notes) {
    fields.Notes = options.notes
  }

  return await airtableFetch<OutboundPitchRecord>({
    method: "PATCH",
    path: recordId,
    config,
    fetchFn: options?.fetchFn,
    body: {
      fields,
      typecast: true,
    },
  })
}
