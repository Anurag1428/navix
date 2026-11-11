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
  companyName: z.string().optional(),
  name: z.string().optional(),
  startupName: z.string().optional(),
  websiteUrl: z.string().optional(),
  url: z.string().optional(),
  website: z.string().optional(),
  domain: z.string().optional(),
  fundingRound: z.string().optional(),
  round: z.string().optional(),
  fundingAmount: z.string().optional(),
  amount: z.string().optional(),
  leadInvestors: z.string().optional(),
  investors: z.string().optional(),
  productSummary: z.string().optional(),
  description: z.string().optional(),
  summary: z.string().optional(),
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
    const companyName = val.companyName || val.name || val.startupName || "Startup"
    const companyDomain = val.websiteUrl || val.url || val.website || val.domain || ""

    if (companyDomain.trim()) {
      items.push({
        companyName: companyName.trim(),
        companyDomain: companyDomain.trim(),
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
  }
) {
  const rawInput = options.values.startups || options.values.instruction
  const allParsed = parseStartupsInput(rawInput)

  if (allParsed.length === 0) {
    return {
      total: 0,
      staged: 0,
      skipped: 0,
      failed: 0,
      summary: "No valid startups found in input.",
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
