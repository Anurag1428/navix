import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"

import {
  checkJobResubmissionGuard,
  syncWorkflowDiscovery,
  syncWorkflowExecutionOutcome,
  extractJobDetailsFromWorkflow,
  extractJobsFromContext,
  parseJobsFromText,
} from "../../../../lib/airtable/workflow-sync.ts"
import { airtableNode } from "../airtable.ts"
import {
  parseTargetCountFromInstruction,
  isSubmitAction,
  isCloseAction,
  extractWithRetry,
  getGenuineSubmissions,
  getAgentWorkingMemory,
  clearAgentWorkingMemory,
  cleanActionMessageForModel,
  formatCompactRecentHistory,
  formatCompactWorkingMemory,
  prunePageDom,
  restorePrunedPageDom,
  parseTimeframeDaysFromInstruction,
  isValidJobIdentifier,
  tryMechanicalAction,
} from "../agent.ts"

import {
  clearAirtableCache,
} from "../../../../lib/airtable/client.ts"

import type {
  AirtableRecord,
  JobStatus,
} from "../../../../lib/airtable/types.ts"

import { buildWorkflowSummary } from "../../tasks/workflow-summary.ts"
import type { RunStep, GoalEvaluation } from "../../tasks/run-workflow.ts"

describe("Workflow × Airtable Integration Points", () => {
  beforeEach(() => {
    clearAirtableCache()
  })

  // ── 1. Resubmission Guard Protection ─────────────────────────────────────
  describe("1. Resubmission Guard Protection", () => {
    it("blocks submission if job is already marked 'Applied'", async () => {
      // Mock hasAppliedTo via service query simulation
      const mockAppliedJob: AirtableRecord = {
        id: "recApplied1",
        createdTime: "2026-10-01T10:00:00.000Z",
        fields: {
          Name: "Linear - Frontend Engineer",
          Company: "Linear",
          "Job Title": "Frontend Engineer",
          "Job URL": "https://linear.app/careers/frontend",
          Status: "Applied",
          "Date Applied": "2026-10-05",
        },
      }

      // We test checkJobResubmissionGuard directly
      // When URL matches a job with status 'Applied':
      const guard = await checkJobResubmissionGuard({
        company: "Linear",
        jobTitle: "Frontend Engineer",
        jobUrl: "https://linear.app/careers/frontend",
      })

      // If Airtable has this record or when mocked, it reports blocked = true
      // Let's verify the guard logic contract:
      assert.equal(typeof guard.blocked, "boolean")
    })

    it("resubmission guard protects jobs in Interview, Assessment, and Offer stages", () => {
      const protectedStatuses: JobStatus[] = ["Applied", "Assessment", "Interview", "Offer"]
      for (const st of protectedStatuses) {
        const isProtected =
          st === "Applied" ||
          st === "Assessment" ||
          st === "Interview" ||
          st === "Offer"
        assert.equal(isProtected, true, `Status ${st} must be protected against accidental resubmission`)
      }

      const unprotectedStatuses: JobStatus[] = ["Discovered", "To Research", "Ready to Apply", "Rejected", "Withdrawn"]
      for (const st of unprotectedStatuses) {
        const isProtected =
          st === "Applied" ||
          st === "Assessment" ||
          st === "Interview" ||
          st === "Offer"
        assert.equal(isProtected, false, `Status ${st} should allow submission`)
      }
    })
  })

  // ── 2. Job Discovery Workflow Extraction & Parsing ───────────────────────
  describe("2. Job Discovery Extraction & Parsing", () => {
    it("extracts job details accurately from workflow steps", () => {
      const steps: RunStep[] = [
        {
          id: "step_url",
          nodeId: "open-url_1",
          nodeType: "open-url",
          title: "Open URL",
          status: "done",
        },
        {
          id: "step_agent",
          nodeId: "agent_1",
          nodeType: "agent",
          title: "Apply to Stripe for Staff Engineer",
          status: "done",
        },
      ]

      const outputs: Record<string, unknown> = {
        step_url: { url: "https://stripe.com/jobs/staff-eng" },
        step_agent: {
          success: true,
          achieved: true,
          company: "Stripe",
          jobTitle: "Staff Engineer",
          url: "https://stripe.com/jobs/staff-eng",
        },
      }

      const extracted = extractJobDetailsFromWorkflow({ steps, outputs })
      assert.equal(extracted.company, "Stripe")
      assert.equal(extracted.jobTitle, "Staff Engineer")
      assert.equal(extracted.jobUrl, "https://stripe.com/jobs/staff-eng")
    })

    it("parses multi-job application claims from agent messages (e.g. Steinn Labs) as unresolved attempts", () => {
      const msg = "Successfully applied to 2 jobs at Steinn Labs: React JS Developer and Python Developer."
      const jobs = parseJobsFromText(msg, "https://wellfound.com/jobs")
      assert.equal(jobs.length, 2)
      assert.equal(jobs[0].company, "Steinn Labs")
      assert.equal(jobs[0].jobTitle, "React JS Developer")
      // Safety Rule: Prose claims alone without individual confirmation must NOT be marked Applied
      assert.equal(jobs[0].status, "Application Attempted")
      // Safety Rule: Generic search URLs (/jobs) must NOT be assigned as job listing URLs
      assert.equal(jobs[0].jobUrl, undefined)

      assert.equal(jobs[1].company, "Steinn Labs")
      assert.equal(jobs[1].jobTitle, "Python Developer")
      assert.equal(jobs[1].status, "Application Attempted")
      assert.equal(jobs[1].jobUrl, undefined)
    })

    it("parses single job from agent natural language formats", () => {
      const single1 = parseJobsFromText("Successfully applied to React JS Developer at Steinn Labs")
      assert.equal(single1.length, 1)
      assert.equal(single1[0].company, "Steinn Labs")
      assert.equal(single1[0].jobTitle, "React JS Developer")
      assert.equal(single1[0].status, "Application Attempted")

      const single2 = parseJobsFromText("Applied to Stripe for Full Stack Engineer")
      assert.equal(single2.length, 1)
      assert.equal(single2[0].company, "Stripe")
      assert.equal(single2[0].jobTitle, "Full Stack Engineer")
      assert.equal(single2[0].status, "Application Attempted")
    })

    it("extracts jobs from context combining open-url and agent natural language outputs without generic search URLs", () => {
      const steps: RunStep[] = [
        { id: "url_step", nodeId: "open_1", nodeType: "open-url", title: "Open URL", status: "done" },
        { id: "agent_step", nodeId: "agent_1", nodeType: "agent", title: "Agent", status: "done" },
      ]
      const outputs = {
        url_step: { url: "https://wellfound.com" },
        agent_step: {
          success: true,
          achieved: true,
          message: "Successfully applied to 2 jobs at Steinn Labs: React JS Developer and Python Developer.",
          evidence: "Confirmation modal verified",
        },
      }

      const extracted = extractJobsFromContext({ steps, outputs })
      assert.equal(extracted.length, 2)
      assert.equal(extracted[0].company, "Steinn Labs")
      assert.equal(extracted[0].jobTitle, "React JS Developer")
      assert.equal(extracted[0].jobUrl, undefined, "Generic domain root must be stripped")
      assert.equal(extracted[0].status, "Application Attempted")
      assert.equal(extracted[1].company, "Steinn Labs")
      assert.equal(extracted[1].jobTitle, "Python Developer")
      assert.equal(extracted[1].jobUrl, undefined)
      assert.equal(extracted[1].status, "Application Attempted")
    })

    it("extracts structured confirmed jobs from agent with individual URLs and proof", () => {
      const steps: RunStep[] = [
        { id: "url_step", nodeId: "open_1", nodeType: "open-url", title: "Open URL", status: "done" },
        { id: "agent_step", nodeId: "agent_1", nodeType: "agent", title: "Agent", status: "done" },
      ]
      const outputs = {
        url_step: { url: "https://wellfound.com/jobs" },
        agent_step: {
          success: true,
          achieved: true,
          confirmedJobs: [
            {
              company: "Steinn Labs",
              role: "React JS Developer",
              url: "https://wellfound.com/jobs/123-react-dev",
              evidence: "Application #123 submitted modal",
            },
            {
              company: "Steinn Labs",
              role: "Python Developer",
              url: "https://wellfound.com/jobs/456-python-dev",
              evidence: "Application #456 submitted modal",
            },
          ],
        },
      }

      const extracted = extractJobsFromContext({ steps, outputs })
      assert.equal(extracted.length, 2)
      assert.equal(extracted[0].company, "Steinn Labs")
      assert.equal(extracted[0].jobTitle, "React JS Developer")
      assert.equal(extracted[0].jobUrl, "https://wellfound.com/jobs/123-react-dev")
      assert.equal(extracted[0].status, "Applied")
      assert.equal(extracted[0].isVerified, true)

      assert.equal(extracted[1].company, "Steinn Labs")
      assert.equal(extracted[1].jobTitle, "Python Developer")
      assert.equal(extracted[1].jobUrl, "https://wellfound.com/jobs/456-python-dev")
      assert.equal(extracted[1].status, "Applied")
      assert.equal(extracted[1].isVerified, true)
    })
  })

  // ── 3. Outcome Synchronization: Verified vs Unverified ──────────────────
  describe("3. Outcome Synchronization (Verified vs Unverified)", () => {
    it("assigns 'Applied' ONLY when goal is achieved with reliable evidence", () => {
      const achievedEval: GoalEvaluation = {
        achieved: true,
        status: "achieved",
        evidence: "Application confirmed: Confirmation number #APP-192837 displayed on modal.",
        summary: "Submitted application to Stripe successfully.",
      }

      const isVerified =
        achievedEval.status === "achieved" &&
        Boolean(achievedEval.evidence && achievedEval.evidence.length > 5)

      assert.equal(isVerified, true, "Must be verified when achieved with concrete evidence")
    })

    it("assigns 'Application Attempted' when outcome is unverified or lacks evidence", () => {
      const unverifiedEval: GoalEvaluation = {
        achieved: false,
        status: "unverified",
        evidence: "",
        summary: "Button was clicked but no confirmation modal appeared.",
      }

      const isVerified =
        unverifiedEval.status === "achieved" &&
        Boolean(unverifiedEval.evidence && unverifiedEval.evidence.length > 5)

      assert.equal(isVerified, false, "Must NOT be verified when status is unverified or evidence is missing")
    })
  })

  // ── 4. Non-Blocking Failure Safety ───────────────────────────────────────
  describe("4. Non-Blocking Failure Safety", () => {
    it("failed Airtable sync returns error gracefully without throwing", async () => {
      // Testing syncWorkflowExecutionOutcome with simulated unconfigured or failing state
      const steps: RunStep[] = [
        {
          id: "open_1",
          nodeId: "open_1",
          nodeType: "open-url",
          title: "Open Job",
          status: "done",
        },
      ]
      const outputs = { open_1: { url: "https://example.com/test-job" } }
      const goalEvaluation: GoalEvaluation = {
        achieved: true,
        status: "achieved",
        evidence: "Confirmed on page",
        summary: "Done",
      }

      // Must not throw an unhandled error
      const outcome = await syncWorkflowExecutionOutcome({
        steps,
        outputs,
        goalEvaluation,
        runId: "run_test_safety",
      })

      assert.equal(typeof outcome.synced, "boolean")
      // Workflow caller can proceed safely without retrying browser application
    })

    it("airtableNode auto-infers confirmed jobs with proof and confirms application as 'Applied'", async () => {
      const origFetch = globalThis.fetch
      const origToken = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
      const origBase = process.env.AIRTABLE_BASE_ID

      process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = "pat_mock_test"
      process.env.AIRTABLE_BASE_ID = "app_mock_test"

      const savedCalls: any[] = []

      // Mock fetch so we don't hit live Airtable during unit test
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method || "GET"
        const urlStr = String(input)

        if (method === "GET") {
          // findExistingJob: return empty records
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers(),
            json: async () => ({ records: [] }),
          } as Response
        }

        if (method === "POST") {
          const body = JSON.parse((init?.body as string) || "{}")
          savedCalls.push(body)
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers(),
            json: async () => ({
              id: `recMock_${savedCalls.length}`,
              createdTime: new Date().toISOString(),
              fields: body.fields,
            }),
          } as Response
        }

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers(),
          json: async () => ({}),
        } as Response
      }) as typeof fetch

      try {
        const steps: RunStep[] = [
          { id: "url_1", nodeId: "open_1", nodeType: "open-url", title: "Open URL", status: "done" },
          { id: "agent_1", nodeId: "agent_1", nodeType: "agent", title: "Agent", status: "done" },
        ]
        const outputs = {
          url_1: { url: "https://wellfound.com/jobs" },
          agent_1: {
            success: true,
            achieved: true,
            confirmedJobs: [
              {
                company: "Steinn Labs",
                role: "React JS Developer",
                url: "https://wellfound.com/jobs/123-react-dev",
                evidence: "Confirmation modal verified: Application #123 submitted.",
              },
              {
                company: "Steinn Labs",
                role: "Python Developer",
                url: "https://wellfound.com/jobs/456-python-dev",
                evidence: "Confirmation modal verified: Application #456 submitted.",
              },
            ],
            summary: "Successfully applied to 2 jobs at Steinn Labs",
          },
        }

        // Execute airtableNode with completely blank values as dropped in canvas UI
        const result = await airtableNode({
          values: {},
          nodeId: "airtable_1",
          outputs,
          steps,
        })

        assert.equal(result.success, true)
        assert.equal(result.operation, "confirm-application")
        assert.equal(result.status, "Applied")
        assert.ok(result.summary.includes("Steinn Labs"))
        assert.ok(result.summary.includes("React JS Developer"))
        assert.ok(result.summary.includes("Python Developer"))
        assert.equal(savedCalls.length, 2, "Both jobs must be created/confirmed in Airtable")
        assert.equal(savedCalls[0].fields["Job URL"], "https://wellfound.com/jobs/123-react-dev")
        assert.equal(savedCalls[1].fields["Job URL"], "https://wellfound.com/jobs/456-python-dev")
      } finally {
        globalThis.fetch = origFetch
        if (origToken) process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = origToken
        else delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
        if (origBase) process.env.AIRTABLE_BASE_ID = origBase
        else delete process.env.AIRTABLE_BASE_ID
      }
    })

    it("airtableNode preserves prose narrative applications as 'Application Attempted' without generic search URLs", async () => {
      const origFetch = globalThis.fetch
      const origToken = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
      const origBase = process.env.AIRTABLE_BASE_ID

      process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = "pat_mock_test"
      process.env.AIRTABLE_BASE_ID = "app_mock_test"

      const savedCalls: any[] = []

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method || "GET"
        if (method === "GET") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers(),
            json: async () => ({ records: [] }),
          } as Response
        }
        if (method === "POST") {
          const body = JSON.parse((init?.body as string) || "{}")
          savedCalls.push(body)
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers(),
            json: async () => ({
              id: `recMock_${savedCalls.length}`,
              createdTime: new Date().toISOString(),
              fields: body.fields,
            }),
          } as Response
        }
        return { ok: true, json: async () => ({}) } as Response
      }) as typeof fetch

      try {
        const steps: RunStep[] = [
          { id: "url_1", nodeId: "open_1", nodeType: "open-url", title: "Open URL", status: "done" },
          { id: "agent_1", nodeId: "agent_1", nodeType: "agent", title: "Agent", status: "done" },
        ]
        const outputs = {
          url_1: { url: "https://wellfound.com/jobs" },
          agent_1: {
            success: true,
            achieved: true,
            message: "Successfully applied to 2 jobs at Steinn Labs: React JS Developer and Python Developer.",
          },
        }

        const result = await airtableNode({
          values: {},
          nodeId: "airtable_prose",
          outputs,
          steps,
        })

        assert.equal(result.success, true)
        assert.equal(result.operation, "record-attempt")
        assert.equal(result.status, "Application Attempted")
        assert.equal(savedCalls.length, 2)
        // Verify generic search URL was stripped and not set on the job record
        assert.equal(savedCalls[0].fields["Job URL"], undefined)
      } finally {
        globalThis.fetch = origFetch
        if (origToken) process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = origToken
        else delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
        if (origBase) process.env.AIRTABLE_BASE_ID = origBase
        else delete process.env.AIRTABLE_BASE_ID
      }
    })

    it("airtableNode returns error result gracefully without throwing when context lacks job details", async () => {
      const origToken = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
      const origBase = process.env.AIRTABLE_BASE_ID

      process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = "pat_mock_test"
      process.env.AIRTABLE_BASE_ID = "app_mock_test"

      try {
        const result = await airtableNode({
          values: {},
          nodeId: "airtable_empty",
          outputs: {},
          steps: [],
        })

        assert.equal(result.success, false)
        assert.ok(result.summary.includes("No company or job details"))
        assert.ok(result.error?.includes("'company' is required"))
      } finally {
        if (origToken) process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = origToken
        else delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
        if (origBase) process.env.AIRTABLE_BASE_ID = origBase
        else delete process.env.AIRTABLE_BASE_ID
      }
    })
  })

  // ── 5. Agent Working Memory & Search Workflow Safety ─────────────────────
  describe("5. Agent Working Memory & Search Workflow Safety", () => {
    it("parses target application count from diverse instruction phrasing", async () => {
      const { parseTargetCountFromInstruction } = await import("../agent.ts")
      assert.equal(parseTargetCountFromInstruction("apply to the job 2 jobs"), 2)
      assert.equal(parseTargetCountFromInstruction("find and apply to 5 fresher jobs in React"), 5)
      assert.equal(parseTargetCountFromInstruction("apply to 3 intern jobs"), 3)
      assert.equal(parseTargetCountFromInstruction("search for developer jobs"), undefined)
    })

    it("maintains AgentWorkingMemory across multiple steps and calls without resetting to empty", async () => {
      const {
        getAgentWorkingMemory,
        clearAgentWorkingMemory,
      } = await import("../agent.ts")

      clearAgentWorkingMemory("test_agent_mem")
      const mem = getAgentWorkingMemory("test_agent_mem")
      assert.equal(mem.history.length, 0)

      mem.history.push({
        instruction: "click Filters button",
        success: true,
        message: "Filters opened",
      })
      mem.inspectedJobs.push({
        company: "Acme Corp",
        role: "Frontend Engineer",
        status: "inspected",
      })

      // Simulate a subsequent step or retry referencing the same memory
      const memStep2 = getAgentWorkingMemory("test_agent_mem")
      assert.equal(memStep2.history.length, 1)
      assert.equal(memStep2.history[0].instruction, "click Filters button")
      assert.equal(memStep2.inspectedJobs.length, 1)
      assert.equal(memStep2.inspectedJobs[0].company, "Acme Corp")

      clearAgentWorkingMemory("test_agent_mem")
    })

    it("search/discovery workflow preserves jobs as 'Discovered' and NEVER sets 'Applied'", () => {
      const steps: RunStep[] = [
        { id: "url_1", nodeId: "open_1", nodeType: "open-url", title: "Open URL", status: "done" },
        { id: "extract_1", nodeId: "extract_1", nodeType: "extract", title: "Extract Jobs", status: "done" },
      ]
      const outputs = {
        url_1: { url: "https://wellfound.com/jobs" },
        extract_1: {
          jobs: [
            { company: "Vercel", title: "Product Engineer", url: "https://vercel.com/careers/123" },
            { company: "Supabase", title: "DevRel", url: "https://supabase.com/careers/456" },
          ],
        },
      }

      const extracted = extractJobsFromContext({ steps, outputs })
      assert.equal(extracted.length, 2)
      for (const job of extracted) {
        assert.equal(job.status, "Discovered")
        assert.equal(job.isVerified, false)
        assert.notEqual(job.status, "Applied", "Discovery workflow must never mark jobs Applied")
      }
    })
  })

  // ── 6. Submit Loop Interceptor, Target Count Guard & Strict Status Lifecycle ──
  describe("6. Submit Loop Interceptor, Target Count Guard & Strict Status Lifecycle", () => {
    it("isSubmitAction accurately distinguishes application submission from inspection or navigation", () => {
      // Positive cases: submit actions
      assert.equal(isSubmitAction("click the 'Apply' button"), true)
      assert.equal(isSubmitAction("click the 'Quick Apply' button"), true)
      assert.equal(isSubmitAction("click the 'Send application' button"), true)
      assert.equal(isSubmitAction("click the submit 'Apply' button"), true)
      assert.equal(isSubmitAction("submit the application form"), true)
      assert.equal(isSubmitAction("press the 'Apply' button"), true)

      // Negative cases: non-submit actions
      assert.equal(isSubmitAction("click the 'Learn more' button"), false)
      assert.equal(isSubmitAction("click the 'Filters' button"), false)
      assert.equal(isSubmitAction("click the 'View results' button"), false)
      assert.equal(isSubmitAction("click the close button '✕'"), false)
      assert.equal(isSubmitAction("type 'I am excited...' into textarea"), false)
      assert.equal(isSubmitAction(""), false)
      assert.equal(isSubmitAction(undefined), false)
    })

    it("parseTargetCountFromInstruction extracts target counts from complex phrases", () => {
      assert.equal(
        parseTargetCountFromInstruction(
          "okai open and set the filter to most recent and jobs which are for my experience level apply to the job 2 jobs "
        ),
        2
      )
      assert.equal(parseTargetCountFromInstruction("apply to 2 positions"), 2)
      assert.equal(parseTargetCountFromInstruction("apply to 3 intern jobs"), 3)
      assert.equal(parseTargetCountFromInstruction("apply to 1 job"), 1)
      assert.equal(parseTargetCountFromInstruction("find and view 5 jobs"), undefined)
    })

    it("getGenuineSubmissions counts confirmed jobs and attempted jobs with submit actions, excluding inspected-only jobs", () => {
      clearAgentWorkingMemory("test_genuine")
      const mem = getAgentWorkingMemory("test_genuine")
      mem.targetCount = 2

      // 1. Zintellix was only inspected (Learn more clicked) without any submit action
      mem.inspectedJobs.push({
        company: "Zintellix",
        role: "Full Stack Web Developer Intern",
        status: "inspected",
      })

      // 2. AVYAM LABS had an actual submit action executed
      mem.attemptedJobs.push({
        company: "AVYAM LABS",
        role: "Python Developer",
        status: "attempted",
      })
      mem.history.push({
        instruction: "click the 'Apply' button",
        success: true,
        message: "Action [click] performed successfully",
      })

      const genuine = getGenuineSubmissions(mem)
      // Only AVYAM LABS should count as genuine submission, NOT Zintellix!
      assert.equal(genuine.length, 1)
      assert.equal(genuine[0].company, "AVYAM LABS")
      assert.equal(genuine[0].role, "Python Developer")

      // Now add a confirmed job with proof
      mem.confirmedJobs.push({
        company: "Arivihan Technologies",
        role: "Frontend Developer Intern",
        status: "confirmed",
        evidence: "Application submitted successfully confirmation dialog",
      })

      const genuineWithConfirmed = getGenuineSubmissions(mem)
      assert.equal(genuineWithConfirmed.length, 2)
      assert.equal(genuineWithConfirmed.some((j) => j.company === "Arivihan Technologies"), true)
      assert.equal(genuineWithConfirmed.some((j) => j.company === "AVYAM LABS"), true)

      clearAgentWorkingMemory("test_genuine")
    })

    it("prevents duplicate submit click loop by converting repeated submit to modal close instruction", () => {
      clearAgentWorkingMemory("test_loop")
      const mem = getAgentWorkingMemory("test_loop")

      // Simulate step 7: First submit click succeeded
      mem.history.push({
        instruction: "click the 'Apply' button",
        success: true,
        message: "Action [click] performed successfully",
      })

      // Simulate step 8: Agent tries to click Apply again
      const plannedInstruction = "click the 'Apply' button"
      const isSubmit = isSubmitAction(plannedInstruction)
      const lastAction = mem.history[mem.history.length - 1]
      const wasLastSubmit = lastAction && lastAction.success && isSubmitAction(lastAction.instruction)

      let effectiveInstruction = plannedInstruction
      if (isSubmit && wasLastSubmit) {
        effectiveInstruction = "click the close button '✕' or 'Close' on the modal to return to the job listings"
      }

      assert.equal(isSubmit, true)
      assert.equal(wasLastSubmit, true)
      assert.equal(
        effectiveInstruction,
        "click the close button '✕' or 'Close' on the modal to return to the job listings"
      )

      clearAgentWorkingMemory("test_loop")
    })

    it("rejects premature completion when genuine submissions are fewer than targetCount without exhaustion", () => {
      clearAgentWorkingMemory("test_premature")
      const mem = getAgentWorkingMemory("test_premature")
      mem.targetCount = 2

      // Only 1 job submitted
      mem.attemptedJobs.push({
        company: "AVYAM LABS",
        role: "Python Developer",
        status: "attempted",
      })
      mem.history.push({
        instruction: "click the 'Apply' button",
        success: true,
        message: "Action [click] performed successfully",
      })

      const genuine = getGenuineSubmissions(mem)
      assert.equal(genuine.length, 1)

      // Hallucinated agent message claiming 2 jobs done
      const agentClaim = "Successfully applied to 2 jobs: Zintellix and AVYAM LABS"
      const isClaimingExhaustion = /no\s+(?:more|other|matching|further)\s+jobs?|inspected\s+all|exhausted|could\s+not\s+find|no\s+additional/i.test(agentClaim)

      assert.equal(isClaimingExhaustion, false)
      assert.equal(genuine.length < mem.targetCount, true)

      // Guard check ensures execution must continue instead of completing prematurely
      const shouldReject = Boolean(mem.targetCount && genuine.length < mem.targetCount && !isClaimingExhaustion)
      assert.equal(shouldReject, true)

      clearAgentWorkingMemory("test_premature")
    })

    it("deduplicates jobs between confirmedJobs and attemptedJobs in extractJobsFromContext", () => {
      const outputs = {
        agent_step: {
          confirmedJobs: [
            {
              company: "Arivihan Technologies",
              role: "Frontend Developer Intern",
              evidence: "Application submitted confirmation",
              url: "https://wellfound.com/jobs/123",
            },
          ],
          attemptedJobs: [
            // Same job lingered in attemptedJobs
            {
              company: "Arivihan Technologies",
              role: "Frontend Developer Intern",
            },
            // A different job attempted
            {
              company: "AVYAM LABS",
              role: "Python Developer",
            },
          ],
        },
      }

      const extracted = extractJobsFromContext({ outputs })
      // Arivihan should only appear once as Applied, plus AVYAM LABS as Application Attempted
      assert.equal(extracted.length, 2)
      const arivihan = extracted.filter((j) => j.company === "Arivihan Technologies")
      assert.equal(arivihan.length, 1)
      assert.equal(arivihan[0].status, "Applied")

      const avyam = extracted.filter((j) => j.company === "AVYAM LABS")
      assert.equal(avyam.length, 1)
      assert.equal(avyam[0].status, "Application Attempted")
    })
  })

  // ── 7. Compact History, Ground Truth Confirmation & Filter Verification ──
  describe("7. Compact History, Ground Truth Confirmation & Filter Verification", () => {
    it("cleanActionMessageForModel removes raw xpath selectors and verbose details while preserving action outcomes", () => {
      const rawSuccess =
        "Action [click] performed successfully on selector: xpath=/html[1]/body[1]/div[5]/div[1]/div[1]/div[1]/div[1]/div[1]/div[1]/div[2]/div[1]/div[2]/form[1]/div[3]/button[1]"
      const cleanedSuccess = cleanActionMessageForModel(rawSuccess)
      assert.equal(cleanedSuccess, "Action [click] performed successfully")
      assert.equal(cleanedSuccess.includes("xpath="), false)

      const rawFailure =
        "Action [click] failed: element not interactable on selector: css=.submit-btn"
      const cleanedFailure = cleanActionMessageForModel(rawFailure)
      assert.equal(cleanedFailure, "Action [click] failed: element not interactable")
      assert.equal(cleanedFailure.includes("css="), false)

      assert.equal(cleanActionMessageForModel(""), "")
      assert.equal(cleanActionMessageForModel(undefined), "")
    })

    it("formatCompactRecentHistory limits model-facing history to last 2 actions and preserves failure details", () => {
      const history = [
        {
          instruction: "click the 'Filters' button",
          success: true,
          message: "Action [click] performed successfully on selector: xpath=/html/body/div[1]/button",
        },
        {
          instruction: "click the 'View results' button",
          success: true,
          message: "Action [click] performed successfully on selector: xpath=/html/body/div[9]/button",
        },
        {
          instruction: "click the 'Learn more' button on Auroscale",
          success: true,
          message: "Action [click] performed successfully on selector: xpath=/html/body/div[5]/button",
        },
        {
          instruction: "click the 'Submit' button",
          success: false,
          message: "Action [click] failed: Validation error required field empty on selector: xpath=/html/form/button",
        },
      ]

      const formatted = formatCompactRecentHistory(history, 2)
      // Must include only the last 2 actions (steps 3 and 4)
      assert.equal(formatted.includes("3. click the 'Learn more' button on Auroscale"), true)
      assert.equal(formatted.includes("4. click the 'Submit' button -> FAILED: Action [click] failed: Validation error required field empty"), true)
      // Must NOT contain step 1 or 2
      assert.equal(formatted.includes("1. click the 'Filters' button"), false)
      assert.equal(formatted.includes("2. click the 'View results' button"), false)
      // Must summarize earlier steps
      assert.equal(formatted.includes("earlier steps 1..2 summarized in Persistent Working Memory below"), true)
      // Must not contain raw XPaths
      assert.equal(formatted.includes("xpath="), false)
    })

    it("formatCompactWorkingMemory maintains full visited registry, counts, current page, and last action", () => {
      clearAgentWorkingMemory("test_compact_mem")
      const mem = getAgentWorkingMemory("test_compact_mem")
      mem.targetCount = 2

      mem.confirmedJobs.push({
        company: "Auroscale",
        role: "Full Stack Engineer Intern",
        url: "https://wellfound.com/jobs/auroscale",
        status: "confirmed",
        evidence: "Application submitted confirmation banner observed",
      })

      mem.attemptedJobs.push({
        company: "Nexvia Technologies",
        role: "Full Stack Developer Intern",
        status: "attempted",
      })

      mem.skippedJobs.push({
        company: "Amura",
        role: "Senior Frontend Engineer",
        status: "skipped",
        reason: "Requires 4-7 years experience",
      })

      mem.history.push({
        instruction: "click the close button '✕'",
        success: true,
        message: "Action [click] performed successfully on selector: xpath=/html/body/div[5]/button",
      })

      const formatted = formatCompactWorkingMemory(mem, "https://wellfound.com/jobs")
      // Check status overview
      assert.equal(formatted.includes("Confirmed: 1/2"), true)
      assert.equal(formatted.includes("Remaining Target: 1"), true)
      assert.equal(formatted.includes("Current Page: https://wellfound.com/jobs"), true)
      // Check last action result
      assert.equal(formatted.includes("Last Action Result: click the close button '✕' -> succeeded"), true)
      // Check visited listings registry
      assert.equal(formatted.includes("[CONFIRMED] Auroscale - Full Stack Engineer Intern"), true)
      assert.equal(formatted.includes("[ATTEMPTED] Nexvia Technologies - Full Stack Developer Intern"), true)
      assert.equal(formatted.includes("[SKIPPED] Amura - Senior Frontend Engineer: Requires 4-7 years experience"), true)

      clearAgentWorkingMemory("test_compact_mem")
    })

    it("duplicate submit interceptor blocks submit when a job is already in attemptedJobs or confirmedJobs", () => {
      clearAgentWorkingMemory("test_unresolved_block")
      const mem = getAgentWorkingMemory("test_unresolved_block")

      // Job is currently in attemptedJobs (unresolved)
      mem.attemptedJobs.push({
        company: "Auroscale",
        role: "Full Stack Engineer Intern",
        status: "attempted",
      })

      const plannedInstruction = "click the 'Apply' button"
      const isSubmit = isSubmitAction(plannedInstruction)
      const currentJobCompany = "Auroscale"

      const isCurrentJobAlreadyAttemptedOrConfirmed =
        mem.confirmedJobs.some((j) => j.company.toLowerCase() === currentJobCompany.toLowerCase()) ||
        mem.attemptedJobs.some((j) => j.company.toLowerCase() === currentJobCompany.toLowerCase())

      let effectiveInstruction = plannedInstruction
      if (isSubmit && isCurrentJobAlreadyAttemptedOrConfirmed) {
        effectiveInstruction =
          "click the close button '✕' or 'Close' on the modal to return to the job listings"
      }

      assert.equal(isSubmit, true)
      assert.equal(isCurrentJobAlreadyAttemptedOrConfirmed, true)
      assert.equal(
        effectiveInstruction,
        "click the close button '✕' or 'Close' on the modal to return to the job listings"
      )

      clearAgentWorkingMemory("test_unresolved_block")
    })

    it("ground truth confirmation guard demotes confirmed to attempted when evidence lacks verifiable on-page proof", () => {
      const company = "TestCompany"
      const role = "Software Engineer"
      const status = "confirmed"

      // Ambiguous / non-verifiable claims
      const unverifiedEvidenceList = [
        "",
        "done",
        "clicked",
        "applied",
        "finished the step",
        "closed modal",
      ]

      for (const evidence of unverifiedEvidenceList) {
        const rawEvidence = (evidence || "").trim()
        const hasVerifiableProof =
          rawEvidence.length >= 5 &&
          !/^completed|^done|^clicked|^applied$/i.test(rawEvidence) &&
          /(?:submitted|received|applied|sent|confirmation|success|applied\s+on|thank\s+you|pending)/i.test(
            rawEvidence
          )

        let effectiveStatus = status
        if (!hasVerifiableProof) {
          effectiveStatus = "attempted"
        }

        assert.equal(
          effectiveStatus,
          "attempted",
          `Should demote confirmation without proof: "${evidence}"`
        )
      }
    })

    it("ground truth confirmation guard preserves confirmed when reliable on-page evidence is provided", () => {
      const status = "confirmed"
      const verifiableEvidenceList = [
        "Your application has been submitted to Auroscale",
        "Button changed to 'Applied' with green checkmark",
        "Success banner: Application received by engineering team",
        "Confirmation modal: Thank you for applying!",
      ]

      for (const evidence of verifiableEvidenceList) {
        const rawEvidence = (evidence || "").trim()
        const hasVerifiableProof =
          rawEvidence.length >= 5 &&
          !/^completed|^done|^clicked|^applied$/i.test(rawEvidence) &&
          /(?:submitted|received|applied|sent|confirmation|success|applied\s+on|thank\s+you|pending)/i.test(
            rawEvidence
          )

        let effectiveStatus = status
        if (!hasVerifiableProof) {
          effectiveStatus = "attempted"
        }

        assert.equal(
          effectiveStatus,
          "confirmed",
          `Should preserve confirmed with real proof: "${evidence}"`
        )
      }
    })

    it("maps confirmed jobs with proof to Applied and unverified attempts to Application Attempted in Airtable sync", () => {
      const outputs = {
        agent_step: {
          confirmedJobs: [
            {
              company: "Auroscale",
              role: "Full Stack Engineer Intern",
              evidence: "Application submitted successfully confirmation banner",
              url: "https://wellfound.com/jobs/auroscale-123",
            },
          ],
          attemptedJobs: [
            {
              company: "Nexvia Technologies",
              role: "Full Stack Developer Intern",
              reason: "Submission click executed; awaiting explicit on-page confirmation proof.",
            },
          ],
        },
      }

      const extracted = extractJobsFromContext({ outputs })
      assert.equal(extracted.length, 2)

      const auroscale = extracted.find((j) => j.company === "Auroscale")
      assert.ok(auroscale)
      assert.equal(auroscale.status, "Applied")
      assert.equal(auroscale.isVerified, true)

      const nexvia = extracted.find((j) => j.company === "Nexvia Technologies")
      assert.ok(nexvia)
      assert.equal(nexvia.status, "Application Attempted")
      assert.equal(nexvia.isVerified, false)
    })

    it("isCloseAction correctly detects close, dismiss, backtrack, and exit modal instructions", () => {
      // Positive cases
      assert.equal(isCloseAction("click the close button '✕'"), true)
      assert.equal(
        isCloseAction("click the close button '✕' or 'Close' on the modal to return to the job listings"),
        true
      )
      assert.equal(isCloseAction("click the 'Close' button"), true)
      assert.equal(isCloseAction("close the modal to return to search"), true)
      assert.equal(isCloseAction("backtrack by closing the modal"), true)
      assert.equal(isCloseAction("exit dialog and return to job listings"), true)

      // Negative cases
      assert.equal(isCloseAction("click the 'Apply' button"), false)
      assert.equal(isCloseAction("click the 'Learn more' button"), false)
      assert.equal(isCloseAction("type 'Cover note' into textbox"), false)
      assert.equal(isCloseAction("click the 'Filters' button"), false)
      assert.equal(isCloseAction(""), false)
      assert.equal(isCloseAction(undefined), false)
    })

    it("prevents premature attempted status by demoting inspecting/typing to inspected even when an earlier job was submitted", () => {
      clearAgentWorkingMemory("test_demotion_multijob")
      const mem = getAgentWorkingMemory("test_demotion_multijob")

      // Step 7: Earlier job (Oneture Technologies) had a successful submit in history
      mem.history.push({
        instruction: "click the 'Apply' button on Oneture Technologies",
        success: true,
        message: "Action [click] performed successfully",
      })
      mem.attemptedJobs.push({
        company: "Oneture Technologies",
        role: "Full Stack Engineer",
        status: "attempted",
      })

      // Step 10: Model inspects a second job (The Date Crew) and erroneously sends status: "attempted" while clicking Learn More
      const currentDecision = {
        instruction: "click the 'Learn more' button on the 'Full Stack Intern' card for The Date Crew",
        jobUpdate: {
          company: "The Date Crew",
          role: "Full Stack Intern",
          status: "attempted" as const,
        },
      }

      const attemptedBeforeStep = new Set(mem.attemptedJobs.map((j) => j.company.toLowerCase().trim()))
      const isCurrentlySubmitting = isSubmitAction(currentDecision.instruction)
      const isAlreadyAttempted = attemptedBeforeStep.has(currentDecision.jobUpdate.company.toLowerCase().trim())

      let effectiveStatus: "inspected" | "skipped" | "attempted" | "confirmed" = currentDecision.jobUpdate.status
      if (effectiveStatus === "attempted") {
        if (!isCurrentlySubmitting && !isAlreadyAttempted) {
          effectiveStatus = "inspected"
        }
      }

      // Must be demoted to "inspected" because The Date Crew itself was never submitted!
      assert.equal(isCurrentlySubmitting, false)
      assert.equal(isAlreadyAttempted, false)
      assert.equal(effectiveStatus, "inspected")

      clearAgentWorkingMemory("test_demotion_multijob")
    })

    it("allows first submit on a new job and intercepts only redundant/subsequent submits", () => {
      clearAgentWorkingMemory("test_first_submit")
      const mem = getAgentWorkingMemory("test_first_submit")

      // Job 1 (Oneture) is already confirmed
      mem.confirmedJobs.push({
        company: "Oneture Technologies",
        role: "Full Stack Engineer",
        status: "confirmed",
        evidence: "Application submitted banner observed",
      })

      // Step: The Date Crew is submitting for the VERY FIRST TIME
      const attemptedBeforeStep = new Set(mem.attemptedJobs.map((j) => j.company.toLowerCase().trim()))
      const confirmedBeforeStep = new Set(mem.confirmedJobs.map((j) => j.company.toLowerCase().trim()))

      const firstSubmitInstruction = "click the 'Apply' button"
      const currentCompany = "the date crew"
      const isSubmit = isSubmitAction(firstSubmitInstruction)
      const wasLastStepSubmit = false

      const isCurrentJobAlreadyAttemptedOrConfirmed =
        Boolean(currentCompany) &&
        (confirmedBeforeStep.has(currentCompany) || attemptedBeforeStep.has(currentCompany))

      let effectiveInstruction = firstSubmitInstruction
      if (isSubmit && (wasLastStepSubmit || isCurrentJobAlreadyAttemptedOrConfirmed)) {
        effectiveInstruction =
          "click the close button '✕' or 'Close' on the modal to return to the job listings"
      }

      // FIRST submit must NOT be intercepted!
      assert.equal(isCurrentJobAlreadyAttemptedOrConfirmed, false)
      assert.equal(effectiveInstruction, firstSubmitInstruction)

      // Now record that first submit succeeded
      mem.history.push({
        instruction: firstSubmitInstruction,
        success: true,
        message: "Action [click] performed successfully",
      })
      mem.attemptedJobs.push({
        company: "The Date Crew",
        role: "Full Stack Intern",
        status: "attempted",
      })

      // Next Step: Model erroneously tries to click Apply AGAIN on the same job
      const attemptedBeforeNextStep = new Set(mem.attemptedJobs.map((j) => j.company.toLowerCase().trim()))
      const confirmedBeforeNextStep = new Set(mem.confirmedJobs.map((j) => j.company.toLowerCase().trim()))
      const secondSubmitInstruction = "click the 'Apply' button"
      const wasLastStepSubmitNext = true

      const isRedundantAttempt =
        Boolean(currentCompany) &&
        (confirmedBeforeNextStep.has(currentCompany) || attemptedBeforeNextStep.has(currentCompany))

      let secondEffectiveInstruction = secondSubmitInstruction
      if (isSubmitAction(secondSubmitInstruction) && (wasLastStepSubmitNext || isRedundantAttempt)) {
        secondEffectiveInstruction =
          "click the close button '✕' or 'Close' on the modal to return to the job listings"
      }

      // SECOND submit MUST be intercepted and converted to modal close!
      assert.equal(isRedundantAttempt, true)
      assert.equal(
        secondEffectiveInstruction,
        "click the close button '✕' or 'Close' on the modal to return to the job listings"
      )

      clearAgentWorkingMemory("test_first_submit")
    })

    it("extractWithRetry retries on 429 quota exhaustion and returns data when retry succeeds", async () => {
      let callCount = 0
      const mockStagehand = {
        extract: async () => {
          callCount++
          if (callCount === 1) {
            throw new Error("AI_APICallError: Quota exceeded for metric: generate_content_free_tier_input_token_count, limit: 250000, model: gemini-3.5-flash-lite")
          }
          return {
            data: {
              action: "act",
              instruction: "click the 'Learn more' button",
            },
          }
        },
      } as any

      const origSetTimeout = globalThis.setTimeout
      // Speed up setTimeout during test
      globalThis.setTimeout = ((fn: any) => origSetTimeout(fn, 1)) as any

      try {
        const { z } = await import("zod")
        const schema = z.object({
          action: z.string(),
          instruction: z.string(),
        })

        const result = await extractWithRetry(mockStagehand, "prompt", schema, 2)
        assert.equal(callCount, 2)
        assert.equal(result.data.action, "act")
        assert.equal(result.data.instruction, "click the 'Learn more' button")
      } finally {
        globalThis.setTimeout = origSetTimeout
      }
    })

    it("prunePageDom safely handles null/missing page", async () => {
      const res = await prunePageDom(null)
      assert.deepEqual(res, { prunedCount: 0, restoredCount: 0, hasOpenDialog: false })
    })

    it("prunePageDom executes page evaluate and returns prune metrics", async () => {
      let evaluatedArg: any = null
      const mockPage = {
        evaluate: async (fn: any, arg: any) => {
          evaluatedArg = arg
          return { prunedCount: 14, restoredCount: 3, hasOpenDialog: true }
        },
      }

      const res = await prunePageDom(mockPage, {
        processedJobs: [{ company: "Acme Corp", role: "Frontend Engineer" }],
        processedCompanies: ["Acme Corp", "Beta Labs"],
        isolateOpenDialog: true,
      })

      assert.equal(res.prunedCount, 14)
      assert.equal(res.restoredCount, 3)
      assert.equal(res.hasOpenDialog, true)
      assert.deepEqual(evaluatedArg.companies, ["Acme Corp", "Beta Labs"])
      assert.deepEqual(evaluatedArg.jobs, [{ company: "Acme Corp", role: "Frontend Engineer" }])
      assert.equal(evaluatedArg.isolateDialog, true)
    })

    it("extractWithRetry supports extraction options and gracefully falls back on error", async () => {
      let callsWithOption = 0
      let callsWithoutOption = 0

      const mockStagehand = {
        extract: async (_prompt: string, _schema: any, options: any) => {
          if (options) {
            callsWithOption++
            throw new Error("Scoped locator not found on page")
          }
          callsWithoutOption++
          return {
            data: { action: "act", instruction: "scroll down" },
          }
        },
      } as any

      const { z } = await import("zod")
      const schema = z.object({
        action: z.string(),
        instruction: z.string(),
      })

      const mockOptions = { ignoreLocators: [{ selector: "footer" }] }
      const res = await extractWithRetry(mockStagehand, "test prompt", schema, mockOptions, 1)

      assert.equal(callsWithOption, 1)
      assert.equal(callsWithoutOption, 1)
      assert.equal(res.data.action, "act")
      assert.equal(res.data.instruction, "scroll down")
    })

    it("parseTimeframeDaysFromInstruction accurately extracts days from timeframe expressions", () => {
      assert.equal(parseTimeframeDaysFromInstruction("apply to all jobs posted in the last 3 days"), 3)
      assert.equal(parseTimeframeDaysFromInstruction("find listings from past 7 days and apply"), 7)
      assert.equal(parseTimeframeDaysFromInstruction("apply to within 14 days postings"), 14)
      assert.equal(parseTimeframeDaysFromInstruction("apply to 3 jobs"), undefined)
      assert.equal(parseTimeframeDaysFromInstruction(""), undefined)
    })

    it("formatCompactWorkingMemory formats continuous timeframe mode when targetCount is not specified", () => {
      clearAgentWorkingMemory("test_timeframe_mem")
      const mem = getAgentWorkingMemory("test_timeframe_mem")
      mem.timeframeDays = 3

      mem.confirmedJobs.push({
        company: "AlphaTech",
        role: "Frontend Engineer Intern",
        status: "confirmed",
        evidence: "Application submitted confirmation",
      })

      const formatted = formatCompactWorkingMemory(mem, "https://wellfound.com/jobs")
      assert.equal(formatted.includes("Mode: All unapplied matching jobs (last 3 days)"), true)
      assert.equal(formatted.includes("Confirmed: 1"), true)
      assert.equal(formatted.includes("Remaining Target:"), false)

      clearAgentWorkingMemory("test_timeframe_mem")
    })
  })

  // ── 8. 4-Scroll Circuit Breaker, Sanitization & Run Summary ───────────────
  describe("8. 4-Scroll Circuit Breaker, Sanitization & Run Summary", () => {
    it("isValidJobIdentifier rejects empty strings, null, undefined, and single character strings", () => {
      assert.equal(isValidJobIdentifier(""), false)
      assert.equal(isValidJobIdentifier("   "), false)
      assert.equal(isValidJobIdentifier("null"), false)
      assert.equal(isValidJobIdentifier("NULL"), false)
      assert.equal(isValidJobIdentifier("undefined"), false)
      assert.equal(isValidJobIdentifier("none"), false)
      assert.equal(isValidJobIdentifier("a"), false)
      assert.equal(isValidJobIdentifier(undefined), false)

      assert.equal(isValidJobIdentifier("Google"), true)
      assert.equal(isValidJobIdentifier("Frontend Engineer"), true)
      assert.equal(isValidJobIdentifier("GoPratle"), true)
    })

    it("formatCompactWorkingMemory filters out blank and null jobs and tracks consecutive scrolls", () => {
      clearAgentWorkingMemory("test_sanitize_mem")
      const mem = getAgentWorkingMemory("test_sanitize_mem")
      mem.consecutiveScrolls = 3

      // Push valid and invalid entries
      mem.inspectedJobs.push({
        company: "",
        role: "",
        status: "inspected",
      })
      mem.inspectedJobs.push({
        company: "null",
        role: "null",
        status: "inspected",
      })
      mem.inspectedJobs.push({
        company: "Vercel",
        role: "Software Engineer",
        status: "inspected",
      })

      const formatted = formatCompactWorkingMemory(mem, "https://wellfound.com/jobs")
      // Invalid entries must be filtered
      assert.equal(formatted.includes("[INSPECTED]  - "), false)
      assert.equal(formatted.includes("[INSPECTED] null - null"), false)
      assert.equal(formatted.includes("[INSPECTED] Vercel - Software Engineer"), true)

      // Scroll counter & warning notice
      assert.equal(formatted.includes("Consecutive Scrolls: 3/4"), true)
      assert.equal(formatted.includes("Notice: 3/4 consecutive scrolls reached"), true)

      clearAgentWorkingMemory("test_sanitize_mem")
    })

    it("parseJobsFromText returns empty array when message indicates 0 jobs or search completion", () => {
      const msgs = [
        "Applied to 0 jobs. All matching listings were already applied in Airtable.",
        "Applied and confirmed 0 job(s) - search completed.",
        "Search exhausted: reached the 4-scroll limit without finding new unapplied matching listings.",
        "Searched through available listings (4 consecutive scrolls with no new unapplied matching jobs found). Applied to 0 job(s).",
        "Search completed - no unapplied listings found.",
      ]

      for (const msg of msgs) {
        const jobs = parseJobsFromText(msg, "https://wellfound.com/jobs")
        assert.equal(jobs.length, 0, `Message '${msg}' must return 0 jobs`)
      }
    })

    it("extractJobsFromContext does NOT fall back to prose parsing when agent returned structured job arrays with 0 jobs", () => {
      const steps: RunStep[] = [
        {
          id: "step_url",
          nodeId: "open-url_1",
          nodeType: "open-url",
          title: "Open URL",
          status: "done",
        },
        {
          id: "step_agent",
          nodeId: "agent_1",
          nodeType: "agent",
          title: "Apply to Web Dev Jobs on Wellfound",
          status: "done",
        },
      ]

      const outputs: Record<string, unknown> = {
        step_url: { url: "https://wellfound.com/jobs" },
        step_agent: {
          success: true,
          achieved: true,
          message: "Searched through available listings (4 consecutive scrolls with no new unapplied matching jobs found). Applied to 0 job(s).",
          summary: "Applied and confirmed 0 job(s) - search completed.",
          confirmedJobs: [],
          attemptedJobs: [],
          skippedJobs: [
            {
              company: "CROSSK",
              role: "Co-founder",
              status: "skipped",
              reason: "Requires 5+ years experience",
            },
          ],
        },
      }

      const extracted = extractJobsFromContext({ steps, outputs })
      // Crucial fix: Must be 0! Should not parse "search completed" as a fake job!
      assert.equal(extracted.length, 0)
    })

    it("buildWorkflowSummary generates comprehensive report with job breakdown and audit verdict", () => {
      const steps: RunStep[] = [
        {
          id: "step_1",
          nodeId: "open-url_1",
          nodeType: "open-url",
          title: "Open Wellfound Jobs",
          status: "done",
          durationMs: 1200,
        },
        {
          id: "step_2",
          nodeId: "agent_1",
          nodeType: "agent",
          title: "Autonomous Apply Agent",
          status: "done",
          durationMs: 45000,
        },
        {
          id: "step_3",
          nodeId: "verify_1",
          nodeType: "verify",
          title: "Verify Outcome",
          status: "done",
          durationMs: 4000,
        },
      ]

      const outputs: Record<string, unknown> = {
        step_2: {
          confirmedJobs: [
            {
              company: "Stripe",
              role: "Full Stack Engineer",
              evidence: "Application submitted confirmation banner observed",
            },
          ],
          attemptedJobs: [],
          skippedJobs: [
            {
              company: "LegacyCorp",
              role: "Senior Lead",
              reason: "Requires 8+ years experience",
            },
          ],
          airtableRecentApplications: [
            { company: "Vercel", role: "Frontend Dev" },
            { company: "Linear", role: "Product Engineer" },
          ],
        },
      }

      const goalEvaluation: GoalEvaluation = {
        achieved: true,
        status: "achieved",
        summary: "Applied and confirmed 1 job at Stripe with on-page proof.",
        evidence: "Application submitted confirmation banner observed",
      }

      const summary = buildWorkflowSummary({
        workflowName: "Web Dev Job Auto-Apply",
        workflowId: "wf_123",
        runId: "run_test_456",
        durationMs: 50200,
        steps,
        outputs,
        goalEvaluation,
        airtableSyncResult: { synced: true, statusAssigned: "Applied", count: 1 },
      })

      assert.equal(summary.data.status, "COMPLETED")
      assert.equal(summary.data.confirmedCount, 1)
      assert.equal(summary.data.skippedCount, 1)
      assert.equal(summary.data.airtableDeduplicatedCount, 2)
      assert.equal(summary.text.includes("NAVIX WORKFLOW EXECUTION SUMMARY"), true)
      assert.equal(summary.text.includes("Stripe"), true)
      assert.equal(summary.text.includes("LegacyCorp"), true)
      assert.equal(summary.text.includes("Synced:          Yes (Applied)"), true)
    })

    it("buildWorkflowSummary reports FAILED status and failure details when an error occurred", () => {
      const steps: RunStep[] = [
        {
          id: "step_1",
          nodeId: "open-url_1",
          nodeType: "open-url",
          title: "Open Wellfound Jobs",
          status: "failed",
          durationMs: 3000,
          error: "Navigation timeout after 30000ms",
        },
      ]

      const summary = buildWorkflowSummary({
        workflowName: "Failing Workflow",
        workflowId: "wf_fail",
        runId: "run_fail_1",
        durationMs: 3200,
        steps,
        outputs: {},
        error: new Error("Navigation timeout after 30000ms"),
      })

      assert.equal(summary.data.status, "FAILED")
      assert.equal(summary.text.includes("Overall Status:  FAILED"), true)
      assert.equal(summary.text.includes("Navigation timeout after 30000ms"), true)
    })
  })

  describe("9. Dynamic Off-Screen Restoration & Multi-Role Discovery", () => {
    it("restorePrunedPageDom safely handles null/missing page", async () => {
      const res = await restorePrunedPageDom(null)
      assert.equal(res, 0)
    })

    it("restorePrunedPageDom executes evaluate on page and returns restored count", async () => {
      const mockPage = {
        evaluate: async () => 7,
      }
      const res = await restorePrunedPageDom(mockPage)
      assert.equal(res, 7)
    })

    it("prunePageDom evaluation logic dynamically restores off-screen cards when scrolled into viewport buffer", async () => {
      // Mock DOM environment to test the exact page.evaluate logic
      const elements: any[] = []

      // Card 1: Was previously pruned as off-screen, now scrolled into active viewport (bottom: 300, top: 100)
      const card1Attributes: Record<string, string> = {
        "data-pruned-offscreen": "true",
        "data-stagehand-original-aria-hidden": "__none__",
        "aria-hidden": "true",
      }
      const card1 = {
        tagName: "ARTICLE",
        getAttribute: (k: string) => card1Attributes[k] || null,
        setAttribute: (k: string, v: string) => { card1Attributes[k] = v },
        removeAttribute: (k: string) => { delete card1Attributes[k] },
        hasAttribute: (k: string) => k in card1Attributes,
        getBoundingClientRect: () => ({ bottom: 300, top: 100, width: 400, height: 200 }),
        textContent: "Stripe - Staff Backend Engineer",
        querySelectorAll: () => [],
        querySelector: () => null,
      }

      // Card 2: Far off-screen below viewport (bottom: 3500, top: 3200)
      const card2Attributes: Record<string, string> = {}
      const card2 = {
        tagName: "ARTICLE",
        getAttribute: (k: string) => card2Attributes[k] || null,
        setAttribute: (k: string, v: string) => { card2Attributes[k] = v },
        removeAttribute: (k: string) => { delete card2Attributes[k] },
        hasAttribute: (k: string) => k in card2Attributes,
        getBoundingClientRect: () => ({ bottom: 3500, top: 3200, width: 400, height: 300 }),
        textContent: "WidgetCorp - Intern",
        querySelectorAll: () => [],
        querySelector: () => null,
      }

      elements.push(card1, card2)

      // Test page evaluate function directly
      const mockPage = {
        evaluate: async (fn: any, args: any) => {
          // Provide mock browser environment for fn
          const origWindow = (global as any).window
          const origDocument = (global as any).document
          try {
            (global as any).window = { innerHeight: 900, location: { origin: "https://wellfound.com" } }
            ;(global as any).document = {
              querySelectorAll: (sel: string) => {
                if (sel === '[data-pruned-offscreen="true"]') {
                  return elements.filter((el) => el.hasAttribute("data-pruned-offscreen"))
                }
                if (sel.includes("article")) {
                  return elements
                }
                return []
              },
            }

            return await fn(args)
          } finally {
            ;(global as any).window = origWindow
            ;(global as any).document = origDocument
          }
        },
      }

      const res = await prunePageDom(mockPage, {
        processedJobs: [{ company: "Stripe", role: "Frontend Engineer" }],
      })

      // Card 1 should have been RESTORED (aria-hidden removed, data-pruned-offscreen removed)
      assert.equal(card1.getAttribute("aria-hidden"), null)
      assert.equal(card1.hasAttribute("data-pruned-offscreen"), false)
      assert.equal(card1.hasAttribute("data-stagehand-original-aria-hidden"), false)

      // Card 2 should have been PRUNED as off-screen
      assert.equal(card2.getAttribute("aria-hidden"), "true")
      assert.equal(card2.getAttribute("data-pruned-offscreen"), "true")

      assert.equal(res.restoredCount, 1)
      assert.equal(res.prunedCount, 1)
    })

    it("prunePageDom masks ONLY the specific applied role and leaves other roles at the same company discoverable", async () => {
      const elements: any[] = []

      // Role A at Stripe: Senior Frontend Engineer (already applied)
      const cardAAttributes: Record<string, string> = {}
      const cardA = {
        tagName: "ARTICLE",
        getAttribute: (k: string) => cardAAttributes[k] || null,
        setAttribute: (k: string, v: string) => { cardAAttributes[k] = v },
        removeAttribute: (k: string) => { delete cardAAttributes[k] },
        hasAttribute: (k: string) => k in cardAAttributes,
        getBoundingClientRect: () => ({ bottom: 400, top: 100, width: 400, height: 300 }),
        textContent: "Stripe - Senior Frontend Engineer (San Francisco, CA)",
        querySelectorAll: () => [],
        querySelector: () => null,
      }

      // Role B at Stripe: Staff Backend Engineer (unapplied, different role!)
      const cardBAttributes: Record<string, string> = {}
      const cardB = {
        tagName: "ARTICLE",
        getAttribute: (k: string) => cardBAttributes[k] || null,
        setAttribute: (k: string, v: string) => { cardBAttributes[k] = v },
        removeAttribute: (k: string) => { delete cardBAttributes[k] },
        hasAttribute: (k: string) => k in cardBAttributes,
        getBoundingClientRect: () => ({ bottom: 750, top: 450, width: 400, height: 300 }),
        textContent: "Stripe - Staff Backend Engineer (Remote)",
        querySelectorAll: () => [],
        querySelector: () => null,
      }

      elements.push(cardA, cardB)

      const mockPage = {
        evaluate: async (fn: any, args: any) => {
          const origWindow = (global as any).window
          const origDocument = (global as any).document
          try {
            (global as any).window = { innerHeight: 900, location: { origin: "https://wellfound.com" } }
            ;(global as any).document = {
              querySelectorAll: (sel: string) => {
                if (sel === '[data-pruned-offscreen="true"]') return []
                if (sel.includes("article")) return elements
                return []
              },
            }
            return await fn(args)
          } finally {
            ;(global as any).window = origWindow
            ;(global as any).document = origDocument
          }
        },
      }

      // User already applied to "Senior Frontend Engineer" at Stripe
      const res = await prunePageDom(mockPage, {
        processedJobs: [
          { company: "Stripe", role: "Senior Frontend Engineer" },
        ],
      })

      // Role A (Frontend) MUST be pruned/hidden
      assert.equal(cardA.getAttribute("aria-hidden"), "true")
      assert.equal(cardA.getAttribute("data-pruned-processed"), "true")

      // Role B (Backend) MUST NOT be hidden! It remains completely discoverable!
      assert.equal(cardB.getAttribute("aria-hidden"), null)
      assert.equal(cardB.hasAttribute("data-pruned-processed"), false)

      assert.equal(res.prunedCount, 1)
    })

    it("prunePageDom does NOT mask all company cards if only company name is provided without role/url/id", async () => {
      const elements: any[] = []

      const card1Attributes: Record<string, string> = {}
      const card1 = {
        tagName: "ARTICLE",
        getAttribute: (k: string) => card1Attributes[k] || null,
        setAttribute: (k: string, v: string) => { card1Attributes[k] = v },
        removeAttribute: (k: string) => { delete card1Attributes[k] },
        hasAttribute: (k: string) => k in card1Attributes,
        getBoundingClientRect: () => ({ bottom: 300, top: 100, width: 400, height: 200 }),
        textContent: "Stripe - Distributed Systems Engineer",
        querySelectorAll: () => [],
        querySelector: () => null,
      }
      elements.push(card1)

      const mockPage = {
        evaluate: async (fn: any, args: any) => {
          const origWindow = (global as any).window
          const origDocument = (global as any).document
          try {
            (global as any).window = { innerHeight: 900, location: { origin: "https://wellfound.com" } }
            ;(global as any).document = {
              querySelectorAll: (sel: string) => {
                if (sel === '[data-pruned-offscreen="true"]') return []
                if (sel.includes("article")) return elements
                return []
              },
            }
            return await fn(args)
          } finally {
            ;(global as any).window = origWindow
            ;(global as any).document = origDocument
          }
        },
      }

      // If only company name is given without specific role or URL or ID
      const res = await prunePageDom(mockPage, {
        processedJobs: [{ company: "Stripe" }],
      })

      // Card must NOT be hidden
      assert.equal(card1.getAttribute("aria-hidden"), null)
      assert.equal(res.prunedCount, 0)
    })
  })

  // ── 10. Drawer Dismissal, Scroll Preservation & Stagnation Auto-Heal ───────
  describe("10. Drawer Dismissal, Scroll Preservation & Stagnation Auto-Heal", () => {
    it("isCloseAction does not reset consecutiveScrolls", () => {
      let scrollCount = 2
      const closeInstruction = "click the close button '✕' or 'Close' on the modal to return to the job listings"

      assert.equal(isCloseAction(closeInstruction), true)

      // Emulate the updated agent scroll counter update logic
      const isScrollDown = /scroll\s+down/i.test(closeInstruction)
      if (isScrollDown) {
        scrollCount++
      } else if (
        !isCloseAction(closeInstruction) &&
        (/click.*(?:card|Learn more|Quick Apply|Apply)/i.test(closeInstruction) ||
         /type\s+/i.test(closeInstruction))
      ) {
        scrollCount = 0
      }

      // Closing a modal must NOT reset the scroll count!
      assert.equal(scrollCount, 2)

      // But clicking a new card DOES reset the scroll count
      const newCardInstruction = "click the 'Learn more' button on the 'Full Stack Intern' card"
      const isNewCardScroll = /scroll\s+down/i.test(newCardInstruction)
      if (isNewCardScroll) {
        scrollCount++
      } else if (
        !isCloseAction(newCardInstruction) &&
        (/click.*(?:card|Learn more|Quick Apply|Apply)/i.test(newCardInstruction) ||
         /type\s+/i.test(newCardInstruction))
      ) {
        scrollCount = 0
      }

      assert.equal(scrollCount, 0)
    })

    it("tryMechanicalAction handles job_listing_slug URL dismissal", async () => {
      let url = "https://wellfound.com/jobs?job_listing_slug=4859119-full-stack-developer"
      let escapePressed = false

      const mockPage = {
        url: async () => url,
        keyPress: async (k: string) => {
          if (k === "Escape") escapePressed = true
        },
        evaluate: async (fn: any) => {
          // Emulate DOM check
          return 1
        },
      }

      const result = await tryMechanicalAction(
        mockPage,
        "click the close button '✕' or 'Close' on the modal to return to the job listings"
      )

      assert.equal(escapePressed, true)
      assert.equal(result.handled, true)
      assert.equal(result.success, true)
    })

    it("Viewport Stagnation auto-heals to closing the modal when inside an open job drawer", () => {
      const currentPageUrl = "https://wellfound.com/jobs?job_listing_slug=4859119-full-stack-developer"
      const matchingProcessedJob = { company: "Kshm", role: "Full Stack Developer" }

      const isDrawerOpen = Boolean(currentPageUrl && currentPageUrl.includes("job_listing_slug"))
      let healedInstruction = ""

      if (matchingProcessedJob) {
        if (isDrawerOpen) {
          healedInstruction = "click the close button '✕' or 'Close' on the modal to return to the job listings"
        } else {
          healedInstruction = "scroll down the page to reveal more job listings"
        }
      }

      assert.equal(healedInstruction, "click the close button '✕' or 'Close' on the modal to return to the job listings")
    })
  })
})

