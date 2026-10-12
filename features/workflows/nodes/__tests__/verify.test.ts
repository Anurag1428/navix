import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    verifyNode,
    inferUpstreamGoal,
} from "../verify.ts"
import type { StepNodeType } from "../node-registry.ts"
import type { Stagehand } from "@browserbasehq/stagehand"

// Mock helper to build a lightweight mock Stagehand instance
function createMockStagehand(options: {
    url?: string
    title?: string
    bodyText?: string
    isBlocked?: boolean
    extractResult?: {
        status: "achieved" | "not_achieved" | "unverified" | "blocked"
        evidence: string
        summary: string
    }
    hasPage?: boolean
}) {
    const {
        url = "https://example.com/checkout",
        title = "Checkout Page",
        bodyText = "Welcome to Example Checkout",
        isBlocked = false,
        extractResult,
        hasPage = true,
    } = options

    const mockPage = hasPage
        ? {
              url: async () => url,
              title: async () => title,
              evaluate: async (fn: () => unknown) => {
                  const fnStr = fn.toString()
                  if (fnStr.includes("hasCloudflare") || fnStr.includes("isBlocked")) {
                      return isBlocked
                  }
                  if (fnStr.includes("innerText")) {
                      return bodyText
                  }
                  return null
              },
          }
        : null

    const mockStagehand = {
        browser: {
            context: {
                activePage: async () => mockPage,
            },
        },
        extract: async () => {
            if (!extractResult) {
                return null
            }
            return {
                data: extractResult,
            }
        },
    }

    return mockStagehand as unknown as Stagehand
}

describe("Verify Goal Node - inferUpstreamGoal", () => {
    it("should infer goal directly from upstreamTask param if present", () => {
        const goalInfo = inferUpstreamGoal({
            upstreamTask: "Book a flight from SFO to JFK",
        })
        assert.deepEqual(goalInfo, {
            goal: "Book a flight from SFO to JFK",
            source: "direct_param",
        })
    })

    it("should infer goal by tracing backwards through connected edge", () => {
        const goalInfo = inferUpstreamGoal({
            workflowContext: {
                nodeId: "verify_node_1",
                nodes: [
                    {
                        id: "agent_node_1",
                        data: {
                            type: "agent",
                            kind: "action",
                            title: "Agent",
                            values: { instruction: "Search for NVDA stock and record price" },
                        },
                    } as unknown as StepNodeType,
                    {
                        id: "verify_node_1",
                        data: {
                            type: "verify",
                            kind: "action",
                            title: "Verify Goal",
                            values: {},
                        },
                    } as unknown as StepNodeType,
                ],
                edges: [{ source: "agent_node_1", target: "verify_node_1" }],
                outputs: {
                    agent_node_1: { summary: "Found NVDA at $120.50" },
                },
            },
        })

        assert.equal(goalInfo?.goal, "Search for NVDA stock and record price")
        assert.equal(goalInfo?.source, "connected_node_agent")
        assert.equal(goalInfo?.upstreamSummary, "Found NVDA at $120.50")
    })

    it("should scan for upstream Agent node when no direct incoming edge is specified", () => {
        const goalInfo = inferUpstreamGoal({
            workflowContext: {
                nodes: [
                    {
                        id: "nav_1",
                        data: {
                            type: "open-url",
                            kind: "action",
                            title: "Open URL",
                            values: { url: "https://example.com" },
                        },
                    } as unknown as StepNodeType,
                    {
                        id: "agent_1",
                        data: {
                            type: "agent",
                            kind: "action",
                            title: "Agent",
                            values: { instruction: "Submit job application form" },
                        },
                    } as unknown as StepNodeType,
                ],
            },
        })

        assert.equal(goalInfo?.goal, "Submit job application form")
        assert.equal(goalInfo?.source, "upstream_agent")
    })

    it("should return null if no upstream instruction exists", () => {
        const goalInfo = inferUpstreamGoal({
            workflowContext: {
                nodes: [
                    {
                        id: "nav_1",
                        data: {
                            type: "open-url",
                            kind: "action",
                            title: "Open URL",
                            values: { url: "https://example.com" },
                        },
                    } as unknown as StepNodeType,
                ],
            },
        })

        assert.equal(goalInfo, null)
    })
})

describe("Verify Goal Node - Automatic & Custom Verification Scenarios", () => {
    it("1. Successful verification in default auto mode with concrete page proof", async () => {
        const stagehand = createMockStagehand({
            url: "https://example.com/confirmation",
            extractResult: {
                status: "achieved",
                evidence: "Confirmation order #98765 visible on screen with receipt",
                summary: "Order was completed successfully with valid order number",
            },
        })

        const result = await verifyNode({
            stagehand,
            upstreamTask: "Order a blue wireless mouse",
        })

        assert.equal(result.mode, "auto")
        assert.equal(result.status, "achieved")
        assert.equal(result.achieved, true)
        assert.equal(result.success, true)
        assert.equal(result.criterion, "Order a blue wireless mouse")
        assert.equal(result.evidence, "Confirmation order #98765 visible on screen with receipt")
        assert.equal(result.summary, "Order was completed successfully with valid order number")
        assert.equal(result.url, "https://example.com/confirmation")
    })

    it("2. Failed verification in default auto mode when page indicates failure", async () => {
        const stagehand = createMockStagehand({
            url: "https://example.com/checkout",
            extractResult: {
                status: "not_achieved",
                evidence: "Validation error: 'Zip code is required' prevented submission",
                summary: "Checkout did not complete due to missing form field errors",
            },
        })

        const result = await verifyNode({
            stagehand,
            upstreamTask: "Submit checkout form",
        })

        assert.equal(result.mode, "auto")
        assert.equal(result.status, "not_achieved")
        assert.equal(result.achieved, false)
        assert.equal(result.success, false)
        assert.match(result.evidence, /Validation error/i)
        assert.match(result.summary, /Checkout did not complete/i)
    })

    it("3. Insufficient evidence in default auto mode returns unverified outcome honestly", async () => {
        // Case A: Model reports insufficient or ambiguous evidence
        const stagehand = createMockStagehand({
            url: "https://example.com/status",
            extractResult: {
                status: "unverified",
                evidence: "Page only displays a generic loader; no success message or receipt is present",
                summary: "Outcome cannot be confirmed from the current page state",
            },
        })

        const result = await verifyNode({
            stagehand,
            upstreamTask: "Transfer $100 to savings",
        })

        assert.equal(result.mode, "auto")
        assert.equal(result.status, "unverified")
        assert.equal(result.achieved, false)
        assert.equal(result.success, false)
        assert.match(result.evidence, /loader/i)

        // Case B: No browser page available
        const stagehandNoPage = createMockStagehand({ hasPage: false })
        const resultNoPage = await verifyNode({
            stagehand: stagehandNoPage,
            upstreamTask: "Transfer $100 to savings",
        })

        assert.equal(resultNoPage.mode, "auto")
        assert.equal(resultNoPage.status, "unverified")
        assert.equal(resultNoPage.achieved, false)
        assert.match(resultNoPage.summary, /browser page state not accessible/i)
    })

    it("4. Missing upstream context returns unverified outcome without failing graph", async () => {
        const stagehand = createMockStagehand({})

        const result = await verifyNode({
            stagehand,
            workflowContext: { nodes: [] },
        })

        assert.equal(result.mode, "auto")
        assert.equal(result.status, "unverified")
        assert.equal(result.achieved, false)
        assert.equal(result.success, false)
        assert.match(result.summary, /missing upstream task context/i)
        assert.match(result.evidence, /No upstream Agent task instruction/i)
    })

    it("5. Custom verification mode with expectedText matching and mismatching", async () => {
        // Matching text
        const stagehandSuccess = createMockStagehand({
            bodyText: "Thank you for your order! Your confirmation # is 4455.",
        })

        const resultSuccess = await verifyNode({
            stagehand: stagehandSuccess,
            expectedText: "Thank you for your order",
        })

        assert.equal(resultSuccess.mode, "custom")
        assert.equal(resultSuccess.status, "achieved")
        assert.equal(resultSuccess.achieved, true)
        assert.equal(resultSuccess.success, true)
        assert.match(resultSuccess.evidence, /confirmed present/i)

        // Mismatching text
        const stagehandFail = createMockStagehand({
            bodyText: "Sorry, your cart is empty.",
        })

        const resultFail = await verifyNode({
            stagehand: stagehandFail,
            expectedText: "Thank you for your order",
        })

        assert.equal(resultFail.mode, "custom")
        assert.equal(resultFail.status, "not_achieved")
        assert.equal(resultFail.achieved, false)
        assert.equal(resultFail.success, false)
        assert.match(resultFail.evidence, /was not found on the page/i)
    })

    it("6. Blocked outcome when security gate / CAPTCHA is detected", async () => {
        const stagehand = createMockStagehand({
            isBlocked: true,
        })

        const result = await verifyNode({
            stagehand,
            upstreamTask: "Search for flights on protected website",
        })

        assert.equal(result.status, "blocked")
        assert.equal(result.achieved, false)
        assert.equal(result.success, false)
        assert.match(result.summary, /security challenge detected/i)
    })
})
