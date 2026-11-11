import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"

import {
  getApolloApiKey,
  calculateEmailConfidence,
  scoreCandidate,
  searchExecutiveByDomain,
  DEFAULT_PRIORITY_TITLES,
} from "../apollo-client.ts"

import {
  ApolloEnrichmentError,
  type ApolloPerson,
  type ApolloSearchResponse,
} from "../types.ts"

function createMockFetch(
  handler: (
    url: string,
    options: RequestInit
  ) => Promise<{
    status: number
    body: any
    headers?: Record<string, string>
  }>
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === "string" ? input : input.toString()
    const result = await handler(urlStr, init || {})
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      statusText: result.status === 200 ? "OK" : `Error ${result.status}`,
      headers: new Headers(result.headers || {}),
      json: async () => result.body,
    } as Response
  }) as typeof fetch
}

describe("Apollo B2B Executive Enrichment Client", () => {
  beforeEach(() => {
    delete process.env.APOLLO_API_KEY
  })

  describe("1. Configuration & Key Resolution", () => {
    it("throws CONFIG_MISSING when APOLLO_API_KEY is absent", () => {
      assert.throws(
        () => getApolloApiKey(),
        (err: any) =>
          err instanceof ApolloEnrichmentError &&
          err.code === "CONFIG_MISSING" &&
          err.message.includes("APOLLO_API_KEY")
      )
    })

    it("reads APOLLO_API_KEY from environment variables", () => {
      process.env.APOLLO_API_KEY = "test_env_api_key_123"
      assert.equal(getApolloApiKey(), "test_env_api_key_123")
    })

    it("prioritizes override key passed in options", () => {
      process.env.APOLLO_API_KEY = "env_key"
      assert.equal(getApolloApiKey("override_key"), "override_key")
    })
  })

  describe("2. Domain Handling & Empty Input", () => {
    it("returns null immediately for empty domain without making HTTP request", async () => {
      let fetchCalled = false
      const mockFetch = createMockFetch(async () => {
        fetchCalled = true
        return { status: 200, body: { people: [] } }
      })

      const result = await searchExecutiveByDomain("", {
        apiKey: "test_key",
        fetchFn: mockFetch,
      })

      assert.equal(result, null)
      assert.equal(fetchCalled, false)
    })

    it("normalizes domain with protocol and www before calling Apollo API", async () => {
      let capturedBody: any = null
      const mockFetch = createMockFetch(async (_url, options) => {
        capturedBody = JSON.parse(options.body as string)
        return {
          status: 200,
          body: {
            people: [
              {
                id: "p1",
                first_name: "Aadit",
                last_name: "Palicha",
                name: "Aadit Palicha",
                title: "Co-Founder & CEO",
                email: "aadit@zepto.co.in",
                email_status: "verified",
              },
            ],
          },
        }
      })

      const result = await searchExecutiveByDomain("https://www.zepto.co.in/careers", {
        apiKey: "test_key",
        fetchFn: mockFetch,
      })

      assert.ok(result)
      assert.equal(result.companyDomain, "zepto.co.in")
      assert.equal(capturedBody.q_organization_domains, "zepto.co.in")
    })
  })

  describe("3. Email Confidence Calculation", () => {
    it("assigns 95 confidence to verified email", () => {
      const person: ApolloPerson = {
        id: "1",
        email: "cto@company.com",
        email_status: "verified",
      }
      assert.equal(calculateEmailConfidence(person), 95)
    })

    it("assigns 75 confidence to extrapolated email", () => {
      const person: ApolloPerson = {
        id: "1",
        email: "cto@company.com",
        email_status: "extrapolated",
      }
      assert.equal(calculateEmailConfidence(person), 75)
    })

    it("assigns 60 confidence to guessed email", () => {
      const person: ApolloPerson = {
        id: "1",
        email: "cto@company.com",
        email_status: "guessed",
      }
      assert.equal(calculateEmailConfidence(person), 60)
    })

    it("returns 0 confidence for missing or locked emails", () => {
      assert.equal(
        calculateEmailConfidence({ id: "1", email: "email_not_unlocked@domain.com" }),
        0
      )
      assert.equal(calculateEmailConfidence({ id: "1", email: undefined }), 0)
      assert.equal(calculateEmailConfidence({ id: "1", email: "" }), 0)
    })
  })

  describe("4. Title Prioritization & Candidate Ranking", () => {
    it("prefers CTO over CEO when both have verified emails", async () => {
      const mockResponse: ApolloSearchResponse = {
        people: [
          {
            id: "ceo_1",
            name: "John Doe",
            first_name: "John",
            title: "Founder & CEO",
            email: "john@techstart.io",
            email_status: "verified",
          },
          {
            id: "cto_1",
            name: "Jane Smith",
            first_name: "Jane",
            title: "Chief Technology Officer",
            email: "jane@techstart.io",
            email_status: "verified",
            linkedin_url: "https://linkedin.com/in/janesmith",
          },
        ],
      }

      const mockFetch = createMockFetch(async () => ({
        status: 200,
        body: mockResponse,
      }))

      const result = await searchExecutiveByDomain("techstart.io", {
        apiKey: "test_key",
        fetchFn: mockFetch,
      })

      assert.ok(result)
      assert.equal(result.name, "Jane Smith")
      assert.equal(result.title, "Chief Technology Officer")
      assert.equal(result.email, "jane@techstart.io")
      assert.equal(result.provider, "apollo")
    })

    it("falls back to CEO when CTO is not present", async () => {
      const mockResponse: ApolloSearchResponse = {
        people: [
          {
            id: "ceo_1",
            name: "Alice Founder",
            first_name: "Alice",
            title: "Co-Founder & CEO",
            email: "alice@earlystage.ai",
            email_status: "verified",
            linkedin_url: "https://linkedin.com/in/alice",
          },
        ],
      }

      const mockFetch = createMockFetch(async () => ({
        status: 200,
        body: mockResponse,
      }))

      const result = await searchExecutiveByDomain("earlystage.ai", {
        apiKey: "test_key",
        fetchFn: mockFetch,
      })

      assert.ok(result)
      assert.equal(result.name, "Alice Founder")
      assert.equal(result.title, "Co-Founder & CEO")
      assert.equal(result.email, "alice@earlystage.ai")
      assert.equal(result.provider, "apollo")
    })

    it("preserves executive details and LinkedIn with provider 'none' when email is missing", async () => {
      const mockResponse: ApolloSearchResponse = {
        people: [
          {
            id: "cto_no_email",
            name: "Bob Builder",
            first_name: "Bob",
            title: "VP of Engineering",
            email: undefined,
            linkedin_url: "https://linkedin.com/in/bobbuilder",
          },
        ],
      }

      const mockFetch = createMockFetch(async () => ({
        status: 200,
        body: mockResponse,
      }))

      const result = await searchExecutiveByDomain("stealth.co", {
        apiKey: "test_key",
        fetchFn: mockFetch,
      })

      assert.ok(result)
      assert.equal(result.name, "Bob Builder")
      assert.equal(result.title, "VP of Engineering")
      assert.equal(result.email, "")
      assert.equal(result.emailConfidence, 0)
      assert.equal(result.linkedinUrl, "https://linkedin.com/in/bobbuilder")
      assert.equal(result.provider, "none")
    })

    it("returns null when Apollo returns empty people list", async () => {
      const mockFetch = createMockFetch(async () => ({
        status: 200,
        body: { people: [] },
      }))

      const result = await searchExecutiveByDomain("unknown-brand.xyz", {
        apiKey: "test_key",
        fetchFn: mockFetch,
      })

      assert.equal(result, null)
    })
  })

  describe("5. Error Handling and Rate Limiting", () => {
    it("throws UNAUTHORIZED on HTTP 401", async () => {
      const mockFetch = createMockFetch(async () => ({
        status: 401,
        body: { message: "Invalid API key" },
      }))

      await assert.rejects(
        async () => {
          await searchExecutiveByDomain("company.com", {
            apiKey: "bad_key",
            fetchFn: mockFetch,
          })
        },
        (err: any) =>
          err instanceof ApolloEnrichmentError &&
          err.code === "UNAUTHORIZED" &&
          err.statusCode === 401
      )
    })

    it("throws FORBIDDEN on HTTP 403 (quota exceeded)", async () => {
      const mockFetch = createMockFetch(async () => ({
        status: 403,
        body: { message: "Plan quota exceeded" },
      }))

      await assert.rejects(
        async () => {
          await searchExecutiveByDomain("company.com", {
            apiKey: "test_key",
            fetchFn: mockFetch,
          })
        },
        (err: any) =>
          err instanceof ApolloEnrichmentError &&
          err.code === "FORBIDDEN" &&
          err.statusCode === 403
      )
    })

    it("retries on HTTP 429 and succeeds on next attempt", async () => {
      let callCount = 0
      const mockFetch = createMockFetch(async () => {
        callCount++
        if (callCount === 1) {
          return {
            status: 429,
            body: { message: "Rate limit exceeded" },
          }
        }
        return {
          status: 200,
          body: {
            people: [
              {
                id: "p1",
                name: "Mohit Kumar",
                title: "CEO",
                email: "mohit@ultrahuman.com",
                email_status: "verified",
              },
            ],
          },
        }
      })

      const result = await searchExecutiveByDomain("ultrahuman.com", {
        apiKey: "test_key",
        fetchFn: mockFetch,
        baseDelayMs: 50,
      })

      assert.ok(result)
      assert.equal(result.name, "Mohit Kumar")
      assert.equal(callCount, 2)
    })

    it("throws RATE_LIMITED when 429 persists past maxRetries", async () => {
      const mockFetch = createMockFetch(async () => ({
        status: 429,
        body: { message: "Rate limit exceeded" },
      }))

      await assert.rejects(
        async () => {
          await searchExecutiveByDomain("busy.com", {
            apiKey: "test_key",
            fetchFn: mockFetch,
            maxRetries: 2,
            baseDelayMs: 20,
          })
        },
        (err: any) =>
          err instanceof ApolloEnrichmentError &&
          err.code === "RATE_LIMITED" &&
          err.statusCode === 429
      )
    })
  })
})
