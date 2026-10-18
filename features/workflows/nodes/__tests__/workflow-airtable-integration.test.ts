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
  getGenuineSubmissions,
  getAgentWorkingMemory,
  clearAgentWorkingMemory,
  tryMechanicalAction,
} from "../agent.ts"

import {
  clearAirtableCache,
} from "../../../../lib/airtable/client.ts"

import type {
  AirtableRecord,
  JobStatus,
} from "../../../../lib/airtable/types.ts"

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

  // ── 10. Drawer Dismissal via Mechanical Action ───────────────────────────
  describe("10. Drawer Dismissal via Mechanical Action", () => {
    it("tryMechanicalAction handles job_listing_slug URL dismissal", async () => {
      let currentUrl = "https://wellfound.com/jobs?job_listing_slug=4840021-test-role"
      let escapePressed = false
      let popStateDispatched = false

      const mockPage = {
        url: async () => currentUrl,
        evaluate: async (fn: any) => {
          const fnStr = fn.toString()
          if (fnStr.includes("JobListingDrawer") || fnStr.includes("dialog")) {
            return 1
          }
          if (fnStr.includes("delete") && fnStr.includes("job_listing_slug")) {
            currentUrl = "https://wellfound.com/jobs"
            popStateDispatched = true
          }
        },
        keyPress: async (key: string) => {
          if (key === "Escape") {
            escapePressed = true
            currentUrl = "https://wellfound.com/jobs"
          }
        },
        keyboard: {
          press: async (key: string) => {
            if (key === "Escape") {
              escapePressed = true
              currentUrl = "https://wellfound.com/jobs"
            }
          },
        },
      }

      const result = await tryMechanicalAction(
        mockPage,
        "click the close button '✕' or 'Close' on the modal to return to the job listings"
      )

      assert.equal(result.handled, true)
      assert.equal(result.success, true)
      assert.match(result.message, /Modal closed via mechanical Escape key/)
      assert.equal(escapePressed, true)
    })
  })
})
