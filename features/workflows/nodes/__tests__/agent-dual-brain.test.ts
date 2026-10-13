import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { generateMicroResponseWithQwen } from "../agent.ts"

describe("Dual-Brain Micro-Brain (Qwen)", () => {
  it("generates a tailored response when GROQ_API_KEY is available or handles missing key gracefully", async () => {
    // Should never throw, returns string or null
    const result = await generateMicroResponseWithQwen({
      company: "Arivihan Technologies",
      role: "Frontend Developer Intern",
      question: "What interests you about working for this company?",
      candidateProfile: "Fresher from IIIT Bhagalpur in CS, strong in React/TypeScript.",
    })

    if (process.env.GROQ_API_KEY) {
      assert.ok(result, "Should return generated response text when GROQ_API_KEY is present")
      assert.ok(result.length > 20, "Should generate a meaningful response")
    } else {
      assert.equal(result, null, "Should return null gracefully when GROQ_API_KEY is missing")
    }
  })
})
