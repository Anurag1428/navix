import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"

import {
  createJobRecord,
  findExistingJob,
  updateJobRecord,
  getJobRecord,
  listJobRecords,
  listJobsNeedingFollowUp,
  saveDiscoveredJob,
  recordApplicationAttempt,
  confirmApplication,
  hasAppliedTo,
  normalizeUrl,
  normalizeText,
  formatDate,
} from "../../../../lib/airtable/service.ts"

import {
  airtableFetch,
  getAirtableConfig,
  clearAirtableCache,
} from "../../../../lib/airtable/client.ts"

import {
  AirtableIntegrationError,
} from "../../../../lib/airtable/types.ts"
import type {
  AirtableConfig,
  AirtableRecord,
  JobApplicationFields,
} from "../../../../lib/airtable/types.ts"

import { airtableNode } from "../airtable.ts"

// Helper to create a mock fetch function
function createMockFetch(
  handler: (url: string, options: RequestInit) => Promise<{ status: number; body: any; headers?: Record<string, string> }>
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
  baseId: "appMockBase123",
  tableName: "Job Applications",
}

describe("Airtable Job Tracking Integration", () => {
  beforeEach(() => {
    clearAirtableCache()
  })

  // ── 1. Configuration & Missing Env Handling ──────────────────────────────
  describe("1. Configuration & Missing Env Handling", () => {
    it("throws actionable CONFIG_MISSING error when token is absent", () => {
      const origToken = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
      delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN

      try {
        assert.throws(
          () => getAirtableConfig(),
          (err: any) => {
            assert.equal(err.code, "CONFIG_MISSING")
            assert.ok(err.message.includes("AIRTABLE_PERSONAL_ACCESS_TOKEN"))
            return true
          }
        )
      } finally {
        if (origToken) process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = origToken
      }
    })

    it("throws actionable CONFIG_MISSING error when base ID is absent", () => {
      const origToken = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
      const origBase = process.env.AIRTABLE_BASE_ID
      process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = "pat_sample"
      delete process.env.AIRTABLE_BASE_ID

      try {
        assert.throws(
          () => getAirtableConfig(),
          (err: any) => {
            assert.equal(err.code, "CONFIG_MISSING")
            assert.ok(err.message.includes("AIRTABLE_BASE_ID"))
            return true
          }
        )
      } finally {
        if (origToken) process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = origToken
        else delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
        if (origBase) process.env.AIRTABLE_BASE_ID = origBase
      }
    })

    it("workflow node throws CONFIG_MISSING without crashing when unconfigured", async () => {
      const origToken = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
      delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN

      try {
        await assert.rejects(
          async () =>
            airtableNode({
              values: {
                operation: "save-discovered",
                company: "Stripe",
                jobTitle: "Engineer",
              },
            }),
          (err: any) => {
            assert.equal(err.code, "CONFIG_MISSING")
            return true
          }
        )
      } finally {
        if (origToken) process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = origToken
      }
    })
  })

  // ── 2. Record Creation and Updates ───────────────────────────────────────
  describe("2. Record Creation and Updates", () => {
    it("creates a job record with composite Name, Discovered status, and date", async () => {
      let capturedBody: any = null

      const mockFetch = createMockFetch(async (url, init) => {
        capturedBody = JSON.parse(init.body as string)
        return {
          status: 200,
          body: {
            id: "recCreated123",
            createdTime: "2026-10-13T12:00:00.000Z",
            fields: capturedBody.fields,
          },
        }
      })

      const record = await createJobRecord(
        {
          company: "Stripe",
          jobTitle: "Senior Frontend Engineer",
          jobUrl: "https://stripe.com/jobs/123",
          salary: "$160k - $200k",
          location: "Remote",
          source: "Wellfound",
        },
        { config: mockConfig, fetchFn: mockFetch }
      )

      assert.equal(record.id, "recCreated123")
      assert.equal(record.fields.Name, "Stripe - Senior Frontend Engineer")
      assert.equal(record.fields.Status, "Discovered")
      assert.equal(record.fields.Company, "Stripe")
      assert.equal(record.fields["Job Title"], "Senior Frontend Engineer")
      assert.equal(record.fields["Job URL"], "https://stripe.com/jobs/123")
      assert.equal(record.fields.Salary, "$160k - $200k")
      assert.ok(record.fields["Date Discovered"])
    })

    it("updates only specified fields without wiping existing data", async () => {
      let capturedPatchBody: any = null

      const existingRecord: AirtableRecord = {
        id: "recExisting999",
        createdTime: "2026-10-10T10:00:00.000Z",
        fields: {
          Name: "Google - Staff SRE",
          Company: "Google",
          "Job Title": "Staff SRE",
          Status: "Discovered",
          "Date Discovered": "2026-10-10",
          Notes: "Found via tech blog.",
        },
      }

      const mockFetch = createMockFetch(async (url, init) => {
        if (init.method === "GET") {
          return { status: 200, body: existingRecord }
        }
        if (init.method === "PATCH") {
          capturedPatchBody = JSON.parse(init.body as string)
          return {
            status: 200,
            body: {
              ...existingRecord,
              fields: {
                ...existingRecord.fields,
                ...capturedPatchBody.fields,
              },
            },
          }
        }
        return { status: 400, body: { error: "Unknown request" } }
      })

      const updated = await updateJobRecord(
        "recExisting999",
        {
          status: "Interview",
          salary: "$250k",
        },
        { config: mockConfig, fetchFn: mockFetch }
      )

      assert.equal(updated.fields.Status, "Interview")
      assert.equal(capturedPatchBody.fields.Status, "Interview")
      assert.equal(capturedPatchBody.fields.Salary, "$250k")
      // Did not attempt to write empty values for other fields
      assert.equal(capturedPatchBody.fields["Date Applied"], undefined)
    })
  })

  // ── 3. Duplicate Detection: URL Normalization ────────────────────────────
  describe("3. Duplicate Detection for Matching URLs", () => {
    it("matches existing job despite tracking parameters, protocol, or trailing slashes", async () => {
      const existingRecord: AirtableRecord = {
        id: "recMatchedUrl",
        createdTime: "2026-10-01T10:00:00.000Z",
        fields: {
          Name: "Linear - Product Designer",
          Company: "Linear",
          "Job Title": "Product Designer",
          "Job URL": "https://www.linear.app/careers/product-designer/",
          Status: "Discovered",
        },
      }

      const mockFetch = createMockFetch(async () => {
        return {
          status: 200,
          body: { records: [existingRecord] },
        }
      })

      // Query has http instead of https, no www, tracking params, and extra query args
      const found = await findExistingJob(
        {
          jobUrl: "http://linear.app/careers/product-designer?utm_source=linkedin&ref=jobboard&utm_medium=cpc",
        },
        { config: mockConfig, fetchFn: mockFetch }
      )

      assert.ok(found, "Job should be found by normalized URL")
      assert.equal(found?.id, "recMatchedUrl")
    })
  })

  // ── 4. Fallback Matching: Normalized Company & Title ─────────────────────
  describe("4. Fallback Matching for Missing URLs", () => {
    it("falls back to matching by company and job title when URL is absent", async () => {
      const existingRecord: AirtableRecord = {
        id: "recMatchedByTitle",
        createdTime: "2026-10-01T10:00:00.000Z",
        fields: {
          Name: "OpenAI - Research Scientist",
          Company: "OpenAI, Inc.",
          "Job Title": "Research Scientist (Alignment)",
          Status: "To Research",
        },
      }

      const mockFetch = createMockFetch(async () => {
        return {
          status: 200,
          body: { records: [existingRecord] },
        }
      })

      // Query with normalized variations (punctuation removed, casing difference)
      const found = await findExistingJob(
        {
          company: "openai inc",
          jobTitle: "research scientist alignment",
        },
        { config: mockConfig, fetchFn: mockFetch }
      )

      assert.ok(found, "Job should be matched by normalized company and title")
      assert.equal(found?.id, "recMatchedByTitle")
    })
  })

  // ── 5. Preservation of Existing Notes and Dates ──────────────────────────
  describe("5. Preservation of Existing Notes and Dates", () => {
    it("appends new notes to existing notes rather than overwriting", async () => {
      let patchBody: any = null

      const existingRecord: AirtableRecord = {
        id: "recNotePreserve",
        createdTime: "2026-10-01T10:00:00.000Z",
        fields: {
          Name: "Netflix - Backend Engineer",
          Company: "Netflix",
          "Job Title": "Backend Engineer",
          Status: "Discovered",
          Notes: "Initial recruiter message received.",
        },
      }

      const mockFetch = createMockFetch(async (url, init) => {
        if (init.method === "GET") {
          return { status: 200, body: existingRecord }
        }
        if (init.method === "PATCH") {
          patchBody = JSON.parse(init.body as string)
          return {
            status: 200,
            body: {
              ...existingRecord,
              fields: { ...existingRecord.fields, ...patchBody.fields },
            },
          }
        }
        return { status: 400, body: {} }
      })

      await updateJobRecord(
        "recNotePreserve",
        { notes: "Completed initial phone screen." },
        { config: mockConfig, fetchFn: mockFetch }
      )

      assert.ok(patchBody.fields.Notes.includes("Initial recruiter message received."))
      assert.ok(patchBody.fields.Notes.includes("Completed initial phone screen."))
    })

    it("saveDiscoveredJob updates missing fields without overwriting user data", async () => {
      let patchCalled = false
      let patchBody: any = null

      const existingRecord: AirtableRecord = {
        id: "recDiscoverExisting",
        createdTime: "2026-10-01T10:00:00.000Z",
        fields: {
          Name: "Datadog - Systems Engineer",
          Company: "Datadog",
          "Job Title": "Systems Engineer",
          Status: "Applied", // User already moved it to Applied!
          Location: "Boston, MA", // User already set location
          "Date Applied": "2026-10-05",
        },
      }

      const mockFetch = createMockFetch(async (url, init) => {
        if (init.method === "GET") {
          return { status: 200, body: { records: [existingRecord] } }
        }
        if (init.method === "PATCH") {
          patchCalled = true
          patchBody = JSON.parse(init.body as string)
          return {
            status: 200,
            body: {
              ...existingRecord,
              fields: { ...existingRecord.fields, ...patchBody.fields },
            },
          }
        }
        return { status: 400, body: {} }
      })

      const result = await saveDiscoveredJob(
        {
          company: "Datadog",
          jobTitle: "Systems Engineer",
          salary: "$180,000", // New info discovered!
          location: "Remote", // Should NOT overwrite Boston, MA
          status: "Discovered", // Should NOT overwrite Applied status
        },
        { config: mockConfig, fetchFn: mockFetch }
      )

      assert.equal(result.isNew, false)
      assert.ok(patchCalled)
      assert.equal(patchBody.fields.Salary, "$180,000")
      assert.equal(patchBody.fields.Location, undefined) // Not overwritten!
      assert.equal(patchBody.fields.Status, undefined) // Status not reverted to Discovered!
    })
  })

  // ── 6. Invalid Fields & Permissions Handling ─────────────────────────────
  describe("6. Invalid Fields and Permissions", () => {
    it("handles HTTP 401 with clear UNAUTHORIZED code", async () => {
      const mockFetch = createMockFetch(async () => ({
        status: 401,
        body: { error: { message: "Invalid personal access token" } },
      }))

      await assert.rejects(
        async () =>
          createJobRecord(
            { company: "Apple", jobTitle: "iOS Dev" },
            { config: mockConfig, fetchFn: mockFetch }
          ),
        (err: any) => {
          assert.equal(err.code, "UNAUTHORIZED")
          assert.equal(err.statusCode, 401)
          return true
        }
      )
    })

    it("handles HTTP 403 with clear FORBIDDEN code and scope guidance", async () => {
      const mockFetch = createMockFetch(async () => ({
        status: 403,
        body: { error: { message: "NOT_AUTHORIZED" } },
      }))

      await assert.rejects(
        async () =>
          createJobRecord(
            { company: "Apple", jobTitle: "iOS Dev" },
            { config: mockConfig, fetchFn: mockFetch }
          ),
        (err: any) => {
          assert.equal(err.code, "FORBIDDEN")
          assert.ok(err.message.includes("data.records:write"))
          return true
        }
      )
    })

    it("handles HTTP 422 with INVALID_FIELD code", async () => {
      const mockFetch = createMockFetch(async () => ({
        status: 422,
        body: {
          error: {
            type: "INVALID_VALUE_FOR_COLUMN",
            message: "Value is not an acceptable select option",
          },
        },
      }))

      await assert.rejects(
        async () =>
          createJobRecord(
            { company: "Apple", jobTitle: "iOS Dev" },
            { config: mockConfig, fetchFn: mockFetch }
          ),
        (err: any) => {
          assert.equal(err.code, "INVALID_FIELD")
          assert.equal(err.statusCode, 422)
          return true
        }
      )
    })
  })

  // ── 7. Pagination and Rate Limits ────────────────────────────────────────
  describe("7. Pagination and Rate Limits", () => {
    it("retries on HTTP 429 rate limit with backoff and succeeds", async () => {
      let attempts = 0

      const mockFetch = createMockFetch(async () => {
        attempts++
        if (attempts === 1) {
          return {
            status: 429,
            body: { error: { message: "Rate limit exceeded" } },
            headers: { "Retry-After": "0" },
          }
        }
        return {
          status: 200,
          body: {
            id: "recRetrySuccess",
            createdTime: "2026-10-13T12:00:00.000Z",
            fields: {
              Name: "Vercel - Frontend Eng",
              Company: "Vercel",
              "Job Title": "Frontend Eng",
              Status: "Discovered",
            },
          },
        }
      })

      const record = await createJobRecord(
        { company: "Vercel", jobTitle: "Frontend Eng" },
        { config: mockConfig, fetchFn: mockFetch }
      )

      assert.equal(attempts, 2)
      assert.equal(record.id, "recRetrySuccess")
    })

    it("handles multiple pages via offset pagination seamlessly", async () => {
      let pageCount = 0

      const mockFetch = createMockFetch(async (url) => {
        pageCount++
        if (url.includes("offset=page2token")) {
          return {
            status: 200,
            body: {
              records: [
                {
                  id: "recPage2",
                  createdTime: "2026-10-13T12:00:00.000Z",
                  fields: {
                    Name: "Meta - E5",
                    Company: "Meta",
                    "Job Title": "E5",
                    Status: "Discovered",
                  },
                },
              ],
            },
          }
        }

        return {
          status: 200,
          body: {
            records: [
              {
                id: "recPage1",
                createdTime: "2026-10-13T12:00:00.000Z",
                fields: {
                  Name: "Amazon - SDE II",
                  Company: "Amazon",
                  "Job Title": "SDE II",
                  Status: "Discovered",
                },
              },
            ],
            offset: "page2token",
          },
        }
      })

      const allRecords = await listJobRecords(
        { limit: 10 },
        { config: mockConfig, fetchFn: mockFetch }
      )

      assert.equal(pageCount, 2)
      assert.equal(allRecords.length, 2)
      assert.equal(allRecords[0].id, "recPage1")
      assert.equal(allRecords[1].id, "recPage2")
    })
  })

  // ── 8. Distinguishing Attempt vs Verified Submission ─────────────────────
  describe("8. Distinguishing Application Attempt from Verified Submission", () => {
    it("sets 'Application Attempted' when submission is not verified or evidence is missing", async () => {
      let createdFields: any = null

      const mockFetch = createMockFetch(async (url, init) => {
        if (init.method === "GET") {
          return { status: 200, body: { records: [] } }
        }
        if (init.method === "POST") {
          createdFields = JSON.parse(init.body as string).fields
          return {
            status: 200,
            body: {
              id: "recAttempt1",
              createdTime: "2026-10-13T12:00:00.000Z",
              fields: createdFields,
            },
          }
        }
        return { status: 400, body: {} }
      })

      const outcome = await confirmApplication(
        {
          company: "Airbnb",
          jobTitle: "Staff Engineer",
          evidence: "", // No evidence!
          isVerified: false, // Not verified!
        },
        { config: mockConfig, fetchFn: mockFetch }
      )

      assert.equal(outcome.statusAssigned, "Application Attempted")
      assert.equal(createdFields.Status, "Application Attempted")
      assert.equal(createdFields["Date Applied"], undefined) // Date Applied must not be set!
    })

    it("sets 'Applied' ONLY when verified submission has reliable evidence", async () => {
      let createdFields: any = null

      const mockFetch = createMockFetch(async (url, init) => {
        if (init.method === "GET") {
          return { status: 200, body: { records: [] } }
        }
        if (init.method === "POST") {
          createdFields = JSON.parse(init.body as string).fields
          return {
            status: 200,
            body: {
              id: "recVerifiedApplied",
              createdTime: "2026-10-13T12:00:00.000Z",
              fields: createdFields,
            },
          }
        }
        return { status: 400, body: {} }
      })

      const outcome = await confirmApplication(
        {
          company: "Airbnb",
          jobTitle: "Staff Engineer",
          evidence: "Confirmation modal visible: 'Thank you for applying to Airbnb! Application ID #AB-88231'.",
          isVerified: true,
          dateApplied: "2026-10-13",
        },
        { config: mockConfig, fetchFn: mockFetch }
      )

      assert.equal(outcome.statusAssigned, "Applied")
      assert.equal(createdFields.Status, "Applied")
      assert.equal(createdFields["Date Applied"], "2026-10-13")
      assert.ok(createdFields["Submission Evidence"].includes("Confirmation modal visible"))
      assert.ok(createdFields["Follow-up Date"]) // Sets default follow-up date
    })
  })

  // ── 9. Preventing Duplicate Application Submissions ──────────────────────
  describe("9. Preventing Duplicate Application Submissions", () => {
    it("blocks application submission for jobs already confirmed as Applied", async () => {
      const confirmedJob: AirtableRecord = {
        id: "recAlreadySubmitted",
        createdTime: "2026-10-05T12:00:00.000Z",
        fields: {
          Name: "Coinbase - Senior Backend",
          Company: "Coinbase",
          "Job Title": "Senior Backend",
          Status: "Applied",
          "Date Applied": "2026-10-05",
        },
      }

      const mockFetch = createMockFetch(async () => {
        return { status: 200, body: { records: [confirmedJob] } }
      })

      // Attempting to record an application attempt for a job already Applied must throw
      await assert.rejects(
        async () =>
          recordApplicationAttempt(
            {
              company: "Coinbase",
              jobTitle: "Senior Backend",
            },
            { config: mockConfig, fetchFn: mockFetch }
          ),
        (err: any) => {
          assert.equal(err.code, "DUPLICATE_APPLICATION")
          assert.ok(err.message.includes("Already confirmed as Applied"))
          return true
        }
      )
    })
  })

  // ── 10. Failed Synchronization After Application Attempt ─────────────────
  describe("10. Failed Synchronization After Application Attempt", () => {
    it("does not crash and retains error details so successful application is not rerun", async () => {
      const mockFetch = createMockFetch(async () => {
        // Airtable is down or returns server error
        return {
          status: 500,
          body: { error: { message: "Internal server error" } },
        }
      })

      const outcome = await confirmApplication(
        {
          company: "GitHub",
          jobTitle: "Platform Engineer",
          evidence: "Application confirmed on page",
          isVerified: true,
        },
        { config: mockConfig, fetchFn: mockFetch }
      )

      // Must report success: false for the sync without throwing uncaught error that would retry browser submission
      assert.equal(outcome.success, false)
      assert.equal(outcome.statusAssigned, "Applied")
      assert.ok(outcome.syncError?.includes("Airtable sync failed"))
    })
  })

  // ── 11. Retrieving Pending Follow-ups ────────────────────────────────────
  describe("11. Retrieving Pending Follow-ups", () => {
    it("returns only active applications where follow-up date has passed or arrived", async () => {
      const records: AirtableRecord[] = [
        {
          id: "recFollowUpDue",
          createdTime: "2026-10-01T12:00:00.000Z",
          fields: {
            Name: "Figma - Staff Eng",
            Company: "Figma",
            "Job Title": "Staff Eng",
            Status: "Applied",
            "Follow-up Date": "2026-10-10", // Past date (due!)
          },
        },
        {
          id: "recFutureFollowUp",
          createdTime: "2026-10-12T12:00:00.000Z",
          fields: {
            Name: "Uber - Tech Lead",
            Company: "Uber",
            "Job Title": "Tech Lead",
            Status: "Applied",
            "Follow-up Date": "2026-10-25", // Future date
          },
        },
        {
          id: "recRejectedNoFollowUp",
          createdTime: "2026-10-01T12:00:00.000Z",
          fields: {
            Name: "Twitter - Dev",
            Company: "Twitter",
            "Job Title": "Dev",
            Status: "Rejected", // Inactive status!
            "Follow-up Date": "2026-10-05",
          },
        },
      ]

      const mockFetch = createMockFetch(async () => ({
        status: 200,
        body: { records },
      }))

      const followUps = await listJobsNeedingFollowUp("2026-10-13", {
        config: mockConfig,
        fetchFn: mockFetch,
      })

      assert.equal(followUps.length, 1)
      assert.equal(followUps[0].id, "recFollowUpDue")
    })
  })
})
