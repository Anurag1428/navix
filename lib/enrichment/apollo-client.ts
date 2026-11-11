import { normalizeDomain } from "../airtable/outbound-service.ts"
import {
  ApolloEnrichmentError,
  type ApolloPerson,
  type ApolloSearchResponse,
  type EnrichedExecutive,
  type ExecutiveSearchOptions,
} from "./types.ts"

const APOLLO_API_ENDPOINT = "https://api.apollo.io/v1/mixed-people/search"

export const DEFAULT_PRIORITY_TITLES: string[] = [
  "cto",
  "chief technology officer",
  "vp of engineering",
  "vice president of engineering",
  "vp engineering",
  "head of engineering",
  "head of ai",
  "director of engineering",
  "founder & cto",
  "co-founder & cto",
  "founder",
  "co-founder",
  "ceo",
  "chief executive officer",
  "founder & ceo",
  "co-founder & ceo",
]

/**
 * Titles used for querying Apollo's person_titles parameter.
 */
export const DEFAULT_SEARCH_TITLES: string[] = [
  "CTO",
  "Chief Technology Officer",
  "VP of Engineering",
  "Vice President of Engineering",
  "Head of Engineering",
  "Head of AI",
  "Founder",
  "Co-Founder",
  "CEO",
  "Chief Executive Officer",
]

/**
 * Resolves the Apollo API Key from options or environment variables.
 */
export function getApolloApiKey(overrideKey?: string): string {
  const apiKey = overrideKey?.trim() || process.env.APOLLO_API_KEY?.trim()
  if (!apiKey) {
    throw new ApolloEnrichmentError(
      "Apollo configuration missing: 'APOLLO_API_KEY' environment variable is required. " +
        "Provide your Apollo API key in your server environment.",
      "CONFIG_MISSING"
    )
  }
  return apiKey
}

/**
 * Calculates an email confidence score (0 to 100) based on Apollo's email status.
 */
export function calculateEmailConfidence(person: ApolloPerson): number {
  const email = person.email?.trim()
  if (!email || email.includes("not_unlocked") || email.includes("unavailable")) {
    return 0
  }

  const status = person.email_status?.toLowerCase()
  switch (status) {
    case "verified":
      return 95
    case "extrapolated":
      return 75
    case "guessed":
      return 60
    default:
      return 50
  }
}

/**
 * Scores an Apollo person candidate against the priority titles hierarchy.
 * Higher score indicates a better fit for technical outreach.
 */
export function scoreCandidate(
  person: ApolloPerson,
  priorityHierarchy: string[] = DEFAULT_PRIORITY_TITLES
): number {
  const candidateTitle = person.title?.trim().toLowerCase() || ""
  let score = 0

  // 1. Title priority matching
  for (let i = 0; i < priorityHierarchy.length; i++) {
    const targetTitle = priorityHierarchy[i].toLowerCase()
    if (candidateTitle.includes(targetTitle)) {
      score += (priorityHierarchy.length - i) * 100
      break
    }
  }

  // Fallback points if candidate has any title at all
  if (score === 0 && candidateTitle) {
    score += 10
  }

  // 2. Email verification bonus
  const emailConfidence = calculateEmailConfidence(person)
  if (emailConfidence >= 90) {
    score += 80
  } else if (emailConfidence >= 70) {
    score += 40
  } else if (emailConfidence > 0) {
    score += 20
  }

  // 3. LinkedIn presence bonus
  if (person.linkedin_url?.trim()) {
    score += 10
  }

  return score
}

/**
 * Searches Apollo.io for the primary technical executive (CTO / CEO) of a given company domain.
 * Applies title prioritization, resolves verified email contacts, and gracefully handles missing emails.
 */
export async function searchExecutiveByDomain(
  domain: string,
  options?: ExecutiveSearchOptions
): Promise<EnrichedExecutive | null> {
  const cleanDomain = normalizeDomain(domain)
  if (!cleanDomain) {
    return null
  }

  const apiKey = getApolloApiKey(options?.apiKey)
  const fetchFn = options?.fetchFn ?? fetch
  const maxRetries = options?.maxRetries ?? 3
  const baseDelayMs = options?.baseDelayMs ?? 200

  const priorityHierarchy = options?.priorityTitles && options.priorityTitles.length > 0
    ? options.priorityTitles.map((t) => t.toLowerCase())
    : DEFAULT_PRIORITY_TITLES

  const requestBody = {
    api_key: apiKey,
    q_organization_domains: cleanDomain,
    person_titles: DEFAULT_SEARCH_TITLES,
    page: 1,
    per_page: 10,
  }

  let attempt = 0
  let lastError: Error | null = null

  while (attempt <= maxRetries) {
    try {
      const response = await fetchFn(APOLLO_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify(requestBody),
      })

      if (response.ok) {
        const data = (await response.json()) as ApolloSearchResponse
        const people = data.people || []

        if (people.length === 0) {
          return null
        }

        // Rank candidates according to title hierarchy and email verification
        const rankedPeople = [...people].sort(
          (a, b) => scoreCandidate(b, priorityHierarchy) - scoreCandidate(a, priorityHierarchy)
        )

        const bestPerson = rankedPeople[0]
        const name =
          bestPerson.name?.trim() ||
          [bestPerson.first_name, bestPerson.last_name].filter(Boolean).join(" ") ||
          "Startup Executive"

        const firstName =
          bestPerson.first_name?.trim() ||
          name.split(" ")[0] ||
          "there"

        const title = bestPerson.title?.trim() || "Executive"
        const emailConfidence = calculateEmailConfidence(bestPerson)
        const hasVerifiedEmail = emailConfidence >= 70

        return {
          name,
          firstName,
          title,
          email: hasVerifiedEmail && bestPerson.email ? bestPerson.email.trim() : "",
          emailConfidence,
          linkedinUrl: bestPerson.linkedin_url?.trim() || undefined,
          companyDomain: cleanDomain,
          provider: hasVerifiedEmail ? "apollo" : "none",
        }
      }

      // Handle specific HTTP error status codes
      const status = response.status
      let errorBody: any = null
      try {
        errorBody = await response.json()
      } catch {
        // Non-JSON response body
      }

      const errorMessage =
        errorBody?.message ||
        errorBody?.error ||
        response.statusText ||
        `HTTP Error ${status}`

      if (status === 401) {
        throw new ApolloEnrichmentError(
          `Apollo authentication failed (401): The provided API key is invalid. ${errorMessage}`,
          "UNAUTHORIZED",
          401,
          errorBody
        )
      }

      if (status === 403) {
        throw new ApolloEnrichmentError(
          `Apollo permission denied or quota exhausted (403): ${errorMessage}`,
          "FORBIDDEN",
          403,
          errorBody
        )
      }

      if (status === 429) {
        attempt++
        if (attempt > maxRetries) {
          throw new ApolloEnrichmentError(
            `Apollo rate limit exceeded (429) after ${maxRetries} retries. ${errorMessage}`,
            "RATE_LIMITED",
            429,
            errorBody
          )
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      if (status >= 500 && status < 600) {
        attempt++
        if (attempt > maxRetries) {
          throw new ApolloEnrichmentError(
            `Apollo server error (${status}) after ${maxRetries} retries: ${errorMessage}`,
            "API_ERROR",
            status,
            errorBody
          )
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      throw new ApolloEnrichmentError(
        `Apollo API request failed with status ${status}: ${errorMessage}`,
        "API_ERROR",
        status,
        errorBody
      )
    } catch (err: any) {
      if (err instanceof ApolloEnrichmentError) {
        throw err
      }

      attempt++
      lastError = err
      if (attempt > maxRetries) {
        throw new ApolloEnrichmentError(
          `Apollo connection failed after ${maxRetries} attempts: ${lastError?.message}`,
          "API_ERROR",
          undefined,
          lastError
        )
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new ApolloEnrichmentError(
    `Apollo request failed after maximum retries: ${lastError?.message || "Unknown error"}`,
    "API_ERROR",
    undefined,
    lastError
  )
}
