import { z } from "zod"
import type { EnrichedExecutive } from "../enrichment/types.ts"

export class PitchSynthesisError extends Error {
  public readonly code:
    | "CONFIG_MISSING"
    | "UNAUTHORIZED"
    | "RATE_LIMITED"
    | "INVALID_OUTPUT"
    | "API_ERROR"
  public readonly statusCode?: number
  public readonly details?: unknown

  constructor(
    message: string,
    code:
      | "CONFIG_MISSING"
      | "UNAUTHORIZED"
      | "RATE_LIMITED"
      | "INVALID_OUTPUT"
      | "API_ERROR",
    statusCode?: number,
    details?: unknown
  ) {
    super(message)
    this.name = "PitchSynthesisError"
    this.code = code
    this.statusCode = statusCode
    this.details = details
    Object.setPrototypeOf(this, PitchSynthesisError.prototype)
  }
}

export interface CandidateProfile {
  name: string
  title: string
  coreSkills: string[]
  proofPoints: string[]
  portfolioUrl?: string
  githubUrl?: string
  linkedinUrl?: string
}

export interface PitchSynthesisInput {
  companyName: string
  companyDomain: string
  fundingRound?: string
  fundingAmount?: string
  leadInvestors?: string
  productSummary?: string
  rawLandingPageText?: string
  executive: EnrichedExecutive
  candidate?: CandidateProfile
}

export interface SynthesizedPitchOutput {
  subject: string
  body: string
  keyHook: string
  alternativeAngles: string[]
  linkedinNote?: string
}

export interface SynthesisOptions {
  apiKey?: string
  model?: string
  fetchFn?: typeof fetch
  maxRetries?: number
  baseDelayMs?: number
}

export const synthesizedPitchSchema = z.object({
  subject: z.string().min(3),
  body: z.string().min(10),
  keyHook: z.string().default(""),
  alternativeAngles: z.array(z.string()).default([]),
  linkedinNote: z.string().optional(),
})
