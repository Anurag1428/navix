import type { AirtableConfig } from "./types.ts"

export type OutboundPitchStatus =
  | "Pending Review"
  | "Approved"
  | "Rejected"
  | "Sent"
  | "Missing Contact"

export type FundingRound =
  | "Pre-Seed"
  | "Seed"
  | "Pre-Series A"
  | "Series A"
  | "Series B"
  | "Series C"
  | "Growth"
  | "Undisclosed"

export interface OutboundPitchFields {
  "Company Name": string
  "Website / Domain": string
  "Funding Round"?: string
  "Funding Amount"?: string
  "Lead Investors"?: string
  "Executive Name"?: string
  "Executive Title"?: string
  "Executive Email"?: string
  "Executive LinkedIn"?: string
  "Email Confidence"?: number
  "Draft Subject"?: string
  "Draft Body"?: string
  "Alternative Angles"?: string
  "LinkedIn Note"?: string
  "Status": OutboundPitchStatus
  "Staged Date": string
  "Navix Run ID"?: string
  "Notes"?: string
}

export interface OutboundPitchRecord {
  id: string
  createdTime: string
  fields: OutboundPitchFields
}

export interface CreateOutboundPitchInput {
  companyName: string
  websiteOrDomain: string
  fundingRound?: string
  fundingAmount?: string
  leadInvestors?: string
  executiveName?: string
  executiveTitle?: string
  executiveEmail?: string
  executiveLinkedIn?: string
  emailConfidence?: number
  draftSubject?: string
  draftBody?: string
  alternativeAngles?: string
  linkedInNote?: string
  status?: OutboundPitchStatus
  stagedDate?: string
  navixRunId?: string
  notes?: string
}

export interface ListOutboundPitchesFilter {
  status?: OutboundPitchStatus | OutboundPitchStatus[]
  companyName?: string
  limit?: number
}

export interface OutboundAirtableOptions {
  config?: AirtableConfig
  fetchFn?: typeof fetch
}
