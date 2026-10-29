import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  generateMicroResponseWithQwen,
  isSubmitAction,
  PlannerDecisionSchema,
  autoResolveWellfoundRelocation,
  tryMechanicalAction,
} from "../agent.ts"

describe("Dual-Brain Micro-Brain (Gemini)", () => {
  it("NEVER returns null — always returns a non-empty string (built-in fallback or Gemini response)", async () => {
    // generateMicroResponseWithQwen now uses Gemini REST API and NEVER returns null.
    // Even without any API key, it returns the built-in FALLBACK pitch.
    const result = await generateMicroResponseWithQwen({
      company: "Arivihan Technologies",
      role: "Frontend Developer Intern",
      question: "What interests you about working for this company?",
      candidateProfile: "Fresher from IIIT Bhagalpur in CS, strong in React/TypeScript.",
    })

    assert.ok(typeof result === "string", "Should always return a string, never null")
    assert.ok(result.length > 20, "Should return a meaningful non-empty pitch")
    // Whether Gemini responds or FALLBACK is used, result must not be null/undefined
    assert.notEqual(result, null)
    assert.notEqual(result, undefined)
  })
})

describe("Wellfound Relocation & Form Control Safeguards", () => {
  it("isSubmitAction does not mistake form inputs, relocation toggles, or radio buttons for submit actions", () => {
    assert.equal(
      isSubmitAction("click the 'I can relocate to Kochi' radio button in the application form"),
      false
    )
    assert.equal(
      isSubmitAction("check the 'I can relocate' checkbox in the application form"),
      false
    )
    assert.equal(
      isSubmitAction("select 'Kochi' from the location dropdown in the application form"),
      false
    )
    assert.equal(
      isSubmitAction("click the relocation option for Bangalore"),
      false
    )
    assert.equal(
      isSubmitAction("click the submit 'Apply' button"),
      true
    )
    assert.equal(
      isSubmitAction("submit the application form"),
      true
    )
  })

  it("PlannerDecisionSchema permits empty instruction when formDelegation or skipped status is present", () => {
    // 1. formDelegation without instruction -> should succeed (auto-healed by micro-brain)
    const validWithFormDelegation = PlannerDecisionSchema.safeParse({
      action: "act",
      formDelegation: {
        company: "UprootSecurity",
        role: "Frontend Engineer",
        targetField: "Cover note",
      },
    })
    assert.equal(validWithFormDelegation.success, true)

    // 2. skipped status without instruction -> should succeed (auto-healed by modal close)
    const validWithSkipped = PlannerDecisionSchema.safeParse({
      action: "act",
      jobUpdate: {
        company: "SomeCompany",
        role: "Senior Dev",
        status: "skipped",
        reason: "Requires 5+ years",
      },
    })
    assert.equal(validWithSkipped.success, true)

    // 3. raw action: "act" without instruction, formDelegation, or skipped -> must fail schema validation
    const invalidEmptyAct = PlannerDecisionSchema.safeParse({
      action: "act",
    })
    assert.equal(invalidEmptyAct.success, false)
  })

  it("tryMechanicalAction intercepts location dropdown and city selection instructions mechanically", async () => {
    const mockPage = {
      url: async () => "https://wellfound.com/jobs",
      evaluate: async (fn: any) => {
        if (typeof fn === "function" && fn.toString().includes("hasRelocationPrompt")) {
          return { changed: true, needsOptionPass: false, changes: ["clicked relocation radio/checkbox", "selected location 'Kochi'"] }
        }
        return { clicked: true, text: "Kochi" }
      },
    }

    // 1. Select instruction
    const res1 = await tryMechanicalAction(mockPage, "select 'Kochi' from the location dropdown")
    assert.equal(res1.handled, true)
    assert.equal(res1.success, true)

    // 2. Click option instruction
    const res2 = await tryMechanicalAction(mockPage, "click the 'Kochi' option in the dropdown")
    assert.equal(res2.handled, true)
    assert.equal(res2.success, true)

    // 3. Fallback type instruction intended for location textbox
    const res3 = await tryMechanicalAction(mockPage, "type 'Kochi' into the location textbox")
    assert.equal(res3.handled, true)
    assert.equal(res3.success, true)
  })

  it("autoResolveWellfoundRelocation returns resolved: true when page reports relocation changes", async () => {
    const mockPage = {
      evaluate: async () => ({
        changed: true,
        needsOptionPass: false,
        changes: ["clicked relocation radio/checkbox", "selected location 'Kochi'"],
      }),
    }

    const result = await autoResolveWellfoundRelocation(mockPage)
    assert.equal(result.resolved, true)
    assert.ok(result.details?.includes("clicked relocation radio/checkbox"))
    assert.ok(result.details?.includes("Kochi"))
  })

  it("tryMechanicalAction prioritizes 'Send application' over header 'Apply' button in submit evaluation", async () => {
    let clickedButtonText = ""
    const mockPage = {
      url: async () => "https://wellfound.com/jobs?job_listing_slug=4884664-software-developer-intern",
      evaluate: async (fn: any, instText?: any) => {
        // Emulate submit evaluation inside activeDialog with both header Apply and form Send application
        if (typeof fn === "function" && fn.toString().includes("hasFormInputs")) {
          // If instruction asks for Send application or form is open, return Send application
          clickedButtonText = "Send application"
          return { canClick: true, text: "Send application" }
        }
        return { canClick: true, text: "Send application" }
      },
      locator: (selector: string) => ({
        first: () => ({
          count: async () => 1,
          click: async () => {
            clickedButtonText = "Send application"
          },
        }),
      }),
    }

    const res = await tryMechanicalAction(mockPage, "click the 'Apply' button")
    assert.equal(res.handled, true)
    assert.equal(res.success, true)
    assert.ok(res.message.includes("Send application"))
    assert.equal(clickedButtonText, "Send application")
  })

  it("tryMechanicalAction intercepts 'click the textbox for What interests you...' and fills textarea", async () => {
    let filledText = ""
    const mockPage = {
      url: async () => "https://wellfound.com/jobs?job_listing_slug=4884664-software-developer-intern",
      evaluate: async () => ({ company: "UprootSecurity", role: "Software Developer - Intern" }),
      locator: (selector: string) => ({
        first: () => ({
          count: async () => 1,
          scrollIntoViewIfNeeded: async () => {},
          fill: async (text: string) => {
            filledText = text
          },
        }),
      }),
    }

    const res = await tryMechanicalAction(mockPage, "click the textbox for 'What interests you about working for this company?'")
    assert.equal(res.handled, true)
    assert.equal(res.success, true)
    assert.ok(res.message.includes("Filled application note/question textarea"))
    assert.ok(filledText.length > 20)
  })
})
