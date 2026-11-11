import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  parseStartupsInput,
  enrichAndStageLeadsNode,
} from "../enrich-and-stage-leads.ts"

describe("Enrich and Stage Leads Workflow Node", () => {
  describe("1. Input Parsing (parseStartupsInput)", () => {
    it("parses direct array of objects with standard keys", () => {
      const raw = [
        {
          companyName: "Zepto",
          websiteUrl: "https://www.zepto.co.in",
          fundingRound: "Series E",
          fundingAmount: "$665M",
          leadInvestors: "StepStone Group",
          productSummary: "Quick commerce delivery",
        },
      ]

      const parsed = parseStartupsInput(raw)
      assert.equal(parsed.length, 1)
      assert.equal(parsed[0].companyName, "Zepto")
      assert.equal(parsed[0].companyDomain, "https://www.zepto.co.in")
      assert.equal(parsed[0].fundingRound, "Series E")
      assert.equal(parsed[0].fundingAmount, "$665M")
    })

    it("parses alternative keys from Stagehand/Inc42 extracts (name, url, round, amount)", () => {
      const raw = [
        {
          name: "Ather Energy",
          url: "atherenergy.com",
          round: "Series E",
          amount: "$71M",
          description: "Smart electric scooters and charging grid",
        },
      ]

      const parsed = parseStartupsInput(raw)
      assert.equal(parsed.length, 1)
      assert.equal(parsed[0].companyName, "Ather Energy")
      assert.equal(parsed[0].companyDomain, "atherenergy.com")
      assert.equal(parsed[0].fundingRound, "Series E")
      assert.equal(parsed[0].productSummary, "Smart electric scooters and charging grid")
    })

    it("parses raw JSON string input", () => {
      const rawStr = JSON.stringify([
        {
          companyName: "Ultrahuman",
          websiteUrl: "ultrahuman.com",
          fundingRound: "Series B",
        },
      ])

      const parsed = parseStartupsInput(rawStr)
      assert.equal(parsed.length, 1)
      assert.equal(parsed[0].companyName, "Ultrahuman")
    })

    it("parses markdown code-fenced JSON string", () => {
      const fenced =
        "```json\n" +
        JSON.stringify([
          {
            companyName: "Sarvam AI",
            websiteUrl: "sarvam.ai",
            fundingRound: "Series A",
          },
        ]) +
        "\n```"

      const parsed = parseStartupsInput(fenced)
      assert.equal(parsed.length, 1)
      assert.equal(parsed[0].companyName, "Sarvam AI")
    })

    it("parses wrapped object { result: [...] } or { startups: [...] }", () => {
      const wrapped = {
        result: [
          { name: "Krutrim", url: "krutrim.com" },
          { name: "Ola Electric", url: "olaelectric.com" },
        ],
      }

      const parsed = parseStartupsInput(wrapped)
      assert.equal(parsed.length, 2)
      assert.equal(parsed[0].companyName, "Krutrim")
      assert.equal(parsed[1].companyName, "Ola Electric")
    })

    it("filters out items missing website/domain", () => {
      const mixed = [
        { name: "NoDomainStartup", url: "" },
        { name: "ValidStartup", url: "valid.com" },
      ]

      const parsed = parseStartupsInput(mixed)
      assert.equal(parsed.length, 1)
      assert.equal(parsed[0].companyName, "ValidStartup")
    })

    it("returns empty array for invalid or empty inputs", () => {
      assert.deepEqual(parseStartupsInput(""), [])
      assert.deepEqual(parseStartupsInput("invalid json string {}"), [])
      assert.deepEqual(parseStartupsInput(null), [])
    })
  })

  describe("2. Batch Limits and Execution", () => {
    it("returns empty metrics when input has no valid startups", async () => {
      const result = await enrichAndStageLeadsNode({
        values: { startups: "[]" },
        nodeId: "node_test_1",
      })

      assert.equal(result.total, 0)
      assert.equal(result.staged, 0)
      assert.equal(result.skipped, 0)
      assert.equal(result.failed, 0)
      assert.ok(result.summary.includes("No valid startups"))
    })
  })
})
