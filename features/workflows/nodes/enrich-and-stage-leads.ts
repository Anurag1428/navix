import { z } from "zod"
import {
  processStartupLead,
  type ProcessStartupLeadPayload,
  type ProcessStartupLeadResult,
} from "@/features/workflows/tasks/process-startup-lead"
import type { NodeContext } from "@/features/workflows/nodes/node-executors"

const MAX_BATCH_SIZE = 15

// Permissive schema to handle slight extraction variations from Stagehand/Inc42
const rawStartupSchema = z.object({
  companyName: z.string().nullish(),
  name: z.string().nullish(),
  startupName: z.string().nullish(),
  websiteUrl: z.string().nullish(),
  url: z.string().nullish(),
  website: z.string().nullish(),
  domain: z.string().nullish(),
  fundingRound: z.string().nullish(),
  round: z.string().nullish(),
  fundingAmount: z.string().nullish(),
  amount: z.string().nullish(),
  leadInvestors: z.string().nullish(),
  investors: z.string().nullish(),
  productSummary: z.string().nullish(),
  description: z.string().nullish(),
  summary: z.string().nullish(),
})

export interface ParsedStartupItem {
  companyName: string
  companyDomain: string
  fundingRound?: string
  fundingAmount?: string
  leadInvestors?: string
  productSummary?: string
}

/**
 * Parses raw JSON text or objects into a normalized array of startup items.
 */
export function resolveCleanDomain(rawDomain: string | null | undefined, companyName: string): string {
  const trimmed = (rawDomain || "").trim()
  let clean = trimmed.toLowerCase()
  clean = clean.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "")
  clean = clean.split("/")[0].split("?")[0].split("#")[0]

  // If the extracted domain is an internal platform ID or lacks a valid TLD dot
  if (!clean || !clean.includes(".") || clean.includes("inc42.com")) {
    const match = companyName.match(/([a-z0-9-]+)\.([a-z]{2,})/i)
    if (match) {
      return match[0].toLowerCase()
    }
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (slug) {
      return `${slug}.com`
    }
  }
  return trimmed
}

export function parseStartupsInput(raw: unknown): ParsedStartupItem[] {
  if (!raw) return []

  let data: unknown = raw
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      data = JSON.parse(trimmed)
    } catch {
      // If wrapped in markdown code fence, clean it
      const cleaned = trimmed.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim()
      try {
        data = JSON.parse(cleaned)
      } catch {
        return []
      }
    }
  }

  // Handle { startups: [...] } or direct array [...]
  const rawList = Array.isArray(data)
    ? data
    : data && typeof data === "object" && "startups" in data && Array.isArray((data as any).startups)
    ? (data as any).startups
    : data && typeof data === "object" && "result" in data && Array.isArray((data as any).result)
    ? (data as any).result
    : []

  const items: ParsedStartupItem[] = []

  for (const rawItem of rawList) {
    const parsed = rawStartupSchema.safeParse(rawItem)
    if (!parsed.success) continue

    const val = parsed.data
    const companyName = (val.companyName || val.name || val.startupName || "").trim()
    if (!companyName || companyName.toLowerCase() === "startup") continue
    const companyDomain = val.websiteUrl || val.url || val.website || val.domain || ""

    const cleanDomain = resolveCleanDomain(companyDomain, companyName)
    if (cleanDomain) {
      items.push({
        companyName,
        companyDomain: cleanDomain,
        fundingRound: val.fundingRound || val.round,
        fundingAmount: val.fundingAmount || val.amount,
        leadInvestors: val.leadInvestors || val.investors,
        productSummary: val.productSummary || val.description || val.summary,
      })
    }
  }

  return items
}

/**
 * Executes a batch with concurrency of 3 to isolate errors and respect API quotas.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  const executing: Promise<void>[] = []

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item)).then((res) => {
      results.push(res)
    })
    executing.push(p)

    if (executing.length >= limit) {
      await Promise.race(executing)
      for (let i = executing.length - 1; i >= 0; i--) {
        // Remove settled promises
        const status = await Promise.race([
          executing[i].then(() => true),
          Promise.resolve(false),
        ])
        if (status) {
          executing.splice(i, 1)
        }
      }
    }
  }

  await Promise.all(executing)
  return results
}

/**
 * Node Executor for 'enrich-and-stage-leads':
 * Consumes an extracted list of funded startups, enforces max batch limits,
 * enriches each decision-maker, synthesizes cold outreach pitches, and stages rows into Airtable.
 */
export async function enrichAndStageLeadsNode(
  options: {
    values: Record<string, string>
    nodeId?: string
    outputs?: Record<string, unknown>
  }
) {
  const rawInput = options.values.startups || options.values.instruction
  let allParsed = parseStartupsInput(rawInput)

  // Fallback: If not found in explicit input, inspect upstream outputs
  if (allParsed.length === 0 && options.outputs) {
    for (const [key, out] of Object.entries(options.outputs)) {
      if (!out || typeof out !== "object") continue
      const anyOut = out as any
      const candidate = anyOut.result || anyOut.startups || anyOut.items || anyOut
      const candidateParsed = parseStartupsInput(candidate)
      if (candidateParsed.length > 0) {
        allParsed = candidateParsed
        break
      }
    }
  }

  if (allParsed.length === 0) {
    console.warn("[enrich-and-stage-leads] No valid startups found in input or upstream outputs. Input was:", rawInput)
    return {
      total: 0,
      staged: 0,
      skipped: 0,
      failed: 0,
      summary: "No valid startups found in input or upstream outputs.",
      results: [],
    }
  }

  // Cap batch at maximum allowed items
  const itemsToProcess = allParsed.slice(0, MAX_BATCH_SIZE)

  // Run processing across startups with concurrency = 3
  const results: ProcessStartupLeadResult[] = await runWithConcurrency(
    itemsToProcess,
    3,
    async (item): Promise<ProcessStartupLeadResult> => {
      const payload: ProcessStartupLeadPayload = {
        companyName: item.companyName,
        companyDomain: item.companyDomain,
        fundingRound: item.fundingRound,
        fundingAmount: item.fundingAmount,
        leadInvestors: item.leadInvestors,
        productSummary: item.productSummary,
        navixRunId: options.nodeId,
      }
      return await processStartupLead(payload)
    }
  )

  const staged = results.filter((r) => r.status === "staged").length
  const skipped = results.filter((r) => r.status === "skipped_duplicate").length
  const failed = results.filter((r) => r.status === "failed").length

  const summary = `Processed ${itemsToProcess.length} startups: ${staged} staged to Airtable, ${skipped} duplicate domains skipped, ${failed} failed.`

  return {
    total: itemsToProcess.length,
    staged,
    skipped,
    failed,
    summary,
    results,
  }
}
