import { logger, task } from "@trigger.dev/sdk"
import {
  checkDomainExists,
  createOutboundPitch,
  normalizeDomain,
} from "@/lib/airtable/outbound-service"
import { searchExecutiveByDomain } from "@/lib/enrichment/apollo-client"
import {
  synthesizeOutreachPitch,
  type CandidateProfile,
} from "@/lib/synthesis"
import type { EnrichedExecutive } from "@/lib/enrichment/types"

export interface ProcessStartupLeadPayload {
  companyName: string
  companyDomain: string
  fundingRound?: string
  fundingAmount?: string
  leadInvestors?: string
  productSummary?: string
  candidateProfileOverride?: CandidateProfile
  navixRunId?: string
}

export interface ProcessStartupLeadResult {
  companyName: string
  companyDomain: string
  status: "staged" | "skipped_duplicate" | "failed"
  airtableRecordId?: string
  pitchStatus?: string
  executiveName?: string
  executiveEmail?: string
  emailConfidence?: number
  provider?: string
  error?: string
}

/**
 * Core business logic to process a single startup lead:
 * 1. Pre-flight Airtable deduplication (preventing duplicate Apollo credit burn).
 * 2. Apollo B2B executive enrichment (CTO/CEO resolution, with graceful fallback).
 * 3. Gemini Flash pitch synthesis (prompt-injection fenced, peer-to-peer tone).
 * 4. Staging into Airtable 'Outbound Pitches' (Status = 'Pending Review' or 'Missing Contact').
 */
export async function processStartupLead(
  payload: ProcessStartupLeadPayload
): Promise<ProcessStartupLeadResult> {
  const cleanDomain = normalizeDomain(payload.companyDomain)
  const companyName = payload.companyName || cleanDomain || "Startup"

  if (!cleanDomain) {
    return {
      companyName,
      companyDomain: payload.companyDomain,
      status: "failed",
      error: "Invalid or empty domain provided.",
    }
  }

  try {
    // 1. Pre-flight deduplication query in Airtable
    const alreadyExists = await checkDomainExists(cleanDomain)
    if (alreadyExists) {
      logger.info(`[Outbound] Domain '${cleanDomain}' already exists in Airtable. Skipping enrichment.`)
      return {
        companyName,
        companyDomain: cleanDomain,
        status: "skipped_duplicate",
      }
    }

    // 2. Apollo B2B Executive Resolution
    let executive: EnrichedExecutive | null = null
    try {
      if (process.env.APOLLO_API_KEY?.trim()) {
        executive = await searchExecutiveByDomain(cleanDomain, {
          companyName,
        })
      } else {
        logger.warn(`[Outbound] APOLLO_API_KEY is not configured. Falling back to placeholder executive for '${cleanDomain}'.`)
      }
    } catch (apolloErr: any) {
      logger.warn(`[Outbound] Apollo lookup error for '${cleanDomain}': ${apolloErr?.message}. Falling back to placeholder.`)
    }

    // If Apollo returns null or is not configured, build fallback placeholder
    if (!executive) {
      executive = {
        name: "Founder",
        firstName: "there",
        title: "Founder / Technical Leader",
        email: "",
        emailConfidence: 0,
        companyDomain: cleanDomain,
        provider: "none",
      }
    }

    // 3. Synthesize personalized outreach pitch
    const pitch = await synthesizeOutreachPitch({
      companyName,
      companyDomain: cleanDomain,
      fundingRound: payload.fundingRound,
      fundingAmount: payload.fundingAmount,
      leadInvestors: payload.leadInvestors,
      productSummary: payload.productSummary,
      executive,
      candidate: payload.candidateProfileOverride,
    })

    // 4. Determine initial staging status
    // If a verified corporate email is present: 'Pending Review'
    // If no verified email is available: 'Missing Contact' (stages LinkedIn profile + LinkedIn note)
    const initialStatus =
      executive.email && executive.provider === "apollo"
        ? "Pending Review"
        : "Missing Contact"

    const record = await createOutboundPitch({
      companyName,
      websiteOrDomain: cleanDomain,
      fundingRound: payload.fundingRound,
      fundingAmount: payload.fundingAmount,
      leadInvestors: payload.leadInvestors,
      executiveName: executive.name,
      executiveTitle: executive.title,
      executiveEmail: executive.email,
      executiveLinkedIn: executive.linkedinUrl,
      emailConfidence: executive.emailConfidence,
      draftSubject: pitch.subject,
      draftBody: pitch.body,
      alternativeAngles: pitch.alternativeAngles?.join("; "),
      linkedInNote: pitch.linkedinNote,
      status: initialStatus,
      navixRunId: payload.navixRunId,
    })

    logger.info(`[Outbound] Successfully staged lead for '${companyName}' (${record.id}) with status '${initialStatus}'.`)

    return {
      companyName,
      companyDomain: cleanDomain,
      status: "staged",
      airtableRecordId: record.id,
      pitchStatus: record.fields.Status,
      executiveName: executive.name,
      executiveEmail: executive.email,
      emailConfidence: executive.emailConfidence,
      provider: executive.provider,
    }
  } catch (err: any) {
    logger.error(`[Outbound] Error processing startup '${cleanDomain}': ${err.message}`)
    return {
      companyName,
      companyDomain: cleanDomain,
      status: "failed",
      error: err.message || "Unknown error during lead processing.",
    }
  }
}

/**
 * Trigger.dev Child Task for processing a single startup lead.
 * Concurrency is clamped to 3 to respect Airtable 5 QPS limits and Apollo quotas.
 */
export const processStartupLeadTask = task({
  id: "process-startup-lead",
  queue: {
    concurrencyLimit: 3,
  },
  run: async (payload: ProcessStartupLeadPayload) => {
    return await processStartupLead(payload)
  },
})
