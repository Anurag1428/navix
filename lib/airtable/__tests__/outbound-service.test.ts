import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"

import {
  normalizeDomain,
  formatAirtableDate,
  getOutboundAirtableConfig,
  checkDomainExists,
  createOutboundPitch,
  listOutboundPitches,
  updateOutboundPitchStatus,
} from "../outbound-service.ts"

import { AirtableIntegrationError } from "../types.ts"
import type { AirtableConfig } from "../types.ts"
import type {
  CreateOutboundPitchInput,
  OutboundPitchFields,
  OutboundPitchRecord,
} from "../outbound-types.ts"

// Helper to create a mock fetch function
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

const mockConfig: AirtableConfig = {
  personalAccessToken: "pat_test_token_12345",
  baseId: "appOutboundMock123",
  tableName: "Outbound Pitches",
}

describe("Airtable Outbound Pitch Staging Service", () => {
  beforeEach(() => {
    delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
    delete process.env.AIRTABLE_BASE_ID
    delete process.env.AIRTABLE_OUTBOUND_BASE_ID
    delete process.env.AIRTABLE_OUTBOUND_TABLE_NAME
  })

  describe("1. Domain Normalization", () => {
    it("strips http, https, and www prefixes", () => {
      assert.equal(normalizeDomain("https://www.zepto.co.in"), "zepto.co.in")
      assert.equal(normalizeDomain("http://zepto.co.in"), "zepto.co.in")
      assert.equal(normalizeDomain("www.ultrahuman.com"), "ultrahuman.com")
    })

    it("strips URL paths, query parameters, and hashes", () => {
      assert.equal(
        normalizeDomain("https://www.atherenergy.com/careers?ref=inc42#apply"),
        "atherenergy.com"
      )
      assert.equal(
        normalizeDomain("http://sub.domain.com/path/to/page"),
        "sub.domain.com"
      )
    })

    it("converts uppercase domains to lowercase and trims whitespace", () => {
      assert.equal(normalizeDomain("   HTTPS://WWW.EXAMPLE.COM/   "), "example.com")
    })

    it("handles empty or falsy inputs gracefully", () => {
      assert.equal(normalizeDomain(""), "")
    })
  })

  describe("2. Configuration Resolution", () => {
    it("throws CONFIG_MISSING when token is absent", () => {
      process.env.AIRTABLE_OUTBOUND_BASE_ID = "app123"
      assert.throws(
        () => getOutboundAirtableConfig(),
        (err: any) =>
          err instanceof AirtableIntegrationError &&
          err.code === "CONFIG_MISSING" &&
          err.message.includes("AIRTABLE_PERSONAL_ACCESS_TOKEN")
      )
    })

    it("throws CONFIG_MISSING when base ID is absent", () => {
      process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = "pat_xyz"
      assert.throws(
        () => getOutboundAirtableConfig(),
        (err: any) =>
          err instanceof AirtableIntegrationError &&
          err.code === "CONFIG_MISSING" &&
          err.message.includes("AIRTABLE_BASE_ID")
      )
    })

    it("prioritizes AIRTABLE_OUTBOUND_BASE_ID over AIRTABLE_BASE_ID", () => {
      process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = "pat_test"
      process.env.AIRTABLE_BASE_ID = "appGenericBase"
      process.env.AIRTABLE_OUTBOUND_BASE_ID = "appDedicatedOutboundBase"

      const config = getOutboundAirtableConfig()
      assert.equal(config.baseId, "appDedicatedOutboundBase")
      assert.equal(config.tableName, "Outbound Pitches")
    })

    it("falls back to AIRTABLE_BASE_ID when AIRTABLE_OUTBOUND_BASE_ID is unset", () => {
      process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = "pat_test"
      process.env.AIRTABLE_BASE_ID = "appFallbackBase"

      const config = getOutboundAirtableConfig()
      assert.equal(config.baseId, "appFallbackBase")
      assert.equal(config.tableName, "Outbound Pitches")
    })

    it("respects override config passed directly", () => {
      const config = getOutboundAirtableConfig({
        personalAccessToken: "pat_override",
        baseId: "appOverrideBase",
        tableName: "Custom Table",
      })
      assert.equal(config.personalAccessToken, "pat_override")
      assert.equal(config.baseId, "appOverrideBase")
      assert.equal(config.tableName, "Custom Table")
    })
  })

  describe("3. Pre-Flight Domain Deduplication (checkDomainExists)", () => {
    it("returns false immediately for empty domain without making a network call", async () => {
      let fetchCalled = false
      const mockFetch = createMockFetch(async () => {
        fetchCalled = true
        return { status: 200, body: { records: [] } }
      })

      const exists = await checkDomainExists("", {
        config: mockConfig,
        fetchFn: mockFetch,
      })
      assert.equal(exists, false)
      assert.equal(fetchCalled, false)
    })

    it("returns true when existing record is found", async () => {
      const mockFetch = createMockFetch(async (url) => {
        assert.ok(url.includes("FIND"))
        assert.ok(url.includes("zepto.co.in"))
        return {
          status: 200,
          body: {
            records: [
              {
                id: "recExisting123",
                fields: { "Website / Domain": "zepto.co.in" },
              },
            ],
          },
        }
      })

      const exists = await checkDomainExists("https://www.zepto.co.in/about", {
        config: mockConfig,
        fetchFn: mockFetch,
      })
      assert.equal(exists, true)
    })

    it("returns false when no matching record is found", async () => {
      const mockFetch = createMockFetch(async () => {
        return { status: 200, body: { records: [] } }
      })

      const exists = await checkDomainExists("newstartup.ai", {
        config: mockConfig,
        fetchFn: mockFetch,
      })
      assert.equal(exists, false)
    })
  })

  describe("4. Pitch Record Creation (createOutboundPitch)", () => {
    it("creates a pitch record with default 'Pending Review' status and date", async () => {
      let capturedBody: any = null

      const mockFetch = createMockFetch(async (_url, options) => {
        assert.equal(options.method, "POST")
        capturedBody = JSON.parse(options.body as string)
        return {
          status: 200,
          body: {
            id: "recNewPitch123",
            createdTime: new Date().toISOString(),
            fields: capturedBody.fields,
          },
        }
      })

      const input: CreateOutboundPitchInput = {
        companyName: "Zepto",
        websiteOrDomain: "https://www.zepto.co.in",
        fundingRound: "Series E",
        fundingAmount: "$665M",
        executiveName: "Aadit Palicha",
        executiveTitle: "CEO",
        executiveEmail: "aadit@zepto.co.in",
        emailConfidence: 95,
        draftSubject: "Quick thought on Zepto quick-commerce routing infrastructure",
        draftBody: "Hi Aadit,\n\nSaw your $665M Series E round. Congrats!...",
      }

      const result = await createOutboundPitch(input, {
        config: mockConfig,
        fetchFn: mockFetch,
      })

      assert.equal(result.id, "recNewPitch123")
      assert.equal(capturedBody.typecast, true)
      assert.equal(capturedBody.fields["Company Name"], "Zepto")
      assert.equal(capturedBody.fields["Website / Domain"], "zepto.co.in")
      assert.equal(capturedBody.fields["Status"], "Pending Review")
      assert.ok(capturedBody.fields["Staged Date"])
      assert.equal(capturedBody.fields["Executive Email"], "aadit@zepto.co.in")
      assert.equal(capturedBody.fields["Email Confidence"], 95)
    })

    it("creates a pitch record using raw OutboundPitchFields input", async () => {
      let capturedBody: any = null

      const mockFetch = createMockFetch(async (_url, options) => {
        capturedBody = JSON.parse(options.body as string)
        return {
          status: 200,
          body: {
            id: "recRawPitch456",
            createdTime: new Date().toISOString(),
            fields: capturedBody.fields,
          },
        }
      })

      const rawFields: OutboundPitchFields = {
        "Company Name": "Ultrahuman",
        "Website / Domain": "ultrahuman.com",
        "Funding Round": "Series B",
        "Executive Name": "Mohit Kumar",
        "Executive Title": "Founder & CEO",
        "Executive Email": "mohit@ultrahuman.com",
        "Email Confidence": 90,
        "Draft Subject": "Biomarker real-time tracking pipelines",
        "Draft Body": "Hi Mohit...",
        "Status": "Pending Review",
        "Staged Date": formatAirtableDate(),
      }

      const result = await createOutboundPitch(rawFields, {
        config: mockConfig,
        fetchFn: mockFetch,
      })

      assert.equal(result.id, "recRawPitch456")
      assert.equal(capturedBody.fields["Company Name"], "Ultrahuman")
    })

    it("throws INVALID_FIELD when company name is missing", async () => {
      await assert.rejects(
        async () => {
          await createOutboundPitch(
            {
              companyName: "",
              websiteOrDomain: "startup.com",
            },
            { config: mockConfig }
          )
        },
        (err: any) =>
          err instanceof AirtableIntegrationError &&
          err.code === "INVALID_FIELD" &&
          err.message.includes("Company Name")
      )
    })

    it("throws INVALID_FIELD when website/domain is missing", async () => {
      await assert.rejects(
        async () => {
          await createOutboundPitch(
            {
              companyName: "Startup",
              websiteOrDomain: "",
            },
            { config: mockConfig }
          )
        },
        (err: any) =>
          err instanceof AirtableIntegrationError &&
          err.code === "INVALID_FIELD" &&
          err.message.includes("Website / Domain")
      )
    })
  })

  describe("5. Querying & Filtering Pitches (listOutboundPitches)", () => {
    it("queries pitches with single status filter", async () => {
      const mockFetch = createMockFetch(async (url) => {
        const decoded = decodeURIComponent(url.replace(/\+/g, " "))
        assert.ok(decoded.includes("{Status} = 'Pending Review'"))
        return {
          status: 200,
          body: {
            records: [
              {
                id: "rec1",
                fields: { "Company Name": "Zepto", Status: "Pending Review" },
              },
            ],
          },
        }
      })

      const pitches = await listOutboundPitches(
        { status: "Pending Review" },
        { config: mockConfig, fetchFn: mockFetch }
      )
      assert.equal(pitches.length, 1)
      assert.equal(pitches[0].id, "rec1")
    })

    it("queries pitches with multiple statuses using OR formula", async () => {
      const mockFetch = createMockFetch(async (url) => {
        const decoded = decodeURIComponent(url.replace(/\+/g, " "))
        assert.ok(decoded.includes("OR("))
        assert.ok(decoded.includes("{Status} = 'Pending Review'"))
        assert.ok(decoded.includes("{Status} = 'Approved'"))
        return {
          status: 200,
          body: {
            records: [
              { id: "rec1", fields: { Status: "Pending Review" } },
              { id: "rec2", fields: { Status: "Approved" } },
            ],
          },
        }
      })

      const pitches = await listOutboundPitches(
        { status: ["Pending Review", "Approved"] },
        { config: mockConfig, fetchFn: mockFetch }
      )
      assert.equal(pitches.length, 2)
    })

    it("filters by company name", async () => {
      const mockFetch = createMockFetch(async (url) => {
        const decoded = decodeURIComponent(url.replace(/\+/g, " "))
        assert.ok(decoded.includes("FIND"))
        assert.ok(decoded.includes("ultrahuman"))
        return {
          status: 200,
          body: {
            records: [{ id: "recU", fields: { "Company Name": "Ultrahuman" } }],
          },
        }
      })

      const pitches = await listOutboundPitches(
        { companyName: "Ultrahuman" },
        { config: mockConfig, fetchFn: mockFetch }
      )
      assert.equal(pitches.length, 1)
      assert.equal(pitches[0].fields["Company Name"], "Ultrahuman")
    })
  })

  describe("6. Status Updates (updateOutboundPitchStatus)", () => {
    it("updates status to Approved with optional notes", async () => {
      let capturedBody: any = null

      const mockFetch = createMockFetch(async (url, options) => {
        assert.equal(options.method, "PATCH")
        assert.ok(url.endsWith("/recToApprove"))
        capturedBody = JSON.parse(options.body as string)
        return {
          status: 200,
          body: {
            id: "recToApprove",
            createdTime: new Date().toISOString(),
            fields: capturedBody.fields,
          },
        }
      })

      const updated = await updateOutboundPitchStatus(
        "recToApprove",
        "Approved",
        {
          notes: "Reviewed and approved by operator",
          config: mockConfig,
          fetchFn: mockFetch,
        }
      )

      assert.equal(updated.id, "recToApprove")
      assert.equal(capturedBody.fields["Status"], "Approved")
      assert.equal(capturedBody.fields["Notes"], "Reviewed and approved by operator")
    })

    it("throws INVALID_FIELD if recordId is missing", async () => {
      await assert.rejects(
        async () => {
          await updateOutboundPitchStatus("", "Approved", { config: mockConfig })
        },
        (err: any) =>
          err instanceof AirtableIntegrationError &&
          err.code === "INVALID_FIELD"
      )
    })
  })

  describe("7. Rate Limiting & API Error Handling", () => {
    it("retries on HTTP 429 rate limit with backoff and succeeds", async () => {
      let callCount = 0
      const mockFetch = createMockFetch(async () => {
        callCount++
        if (callCount === 1) {
          return {
            status: 429,
            body: { error: { message: "Too Many Requests", type: "RATE_LIMIT" } },
          }
        }
        return {
          status: 200,
          body: { records: [] },
        }
      })

      const exists = await checkDomainExists("test-retry.com", {
        config: mockConfig,
        fetchFn: mockFetch,
      })

      assert.equal(exists, false)
      assert.equal(callCount, 2)
    })

    it("handles HTTP 401 Unauthorized with descriptive error", async () => {
      const mockFetch = createMockFetch(async () => {
        return {
          status: 401,
          body: { error: { message: "Invalid personal access token" } },
        }
      })

      await assert.rejects(
        async () => {
          await checkDomainExists("test.com", {
            config: mockConfig,
            fetchFn: mockFetch,
          })
        },
        (err: any) =>
          err instanceof AirtableIntegrationError &&
          err.code === "UNAUTHORIZED" &&
          err.statusCode === 401
      )
    })
  })
})
