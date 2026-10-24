import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    resolveDynamicLocation,
    buildCandidateContextForQwen,
    DEFAULT_CANDIDATE_MACRO_SUMMARY,
    MASTER_CANDIDATE_PROFILE,
} from "../candidate-profile.ts"

describe("Candidate Profile & Dynamic Adaptation", () => {
    it("dynamically resolves location to match target job hubs (Gurgaon, Noida, Bengaluru)", () => {
        assert.equal(resolveDynamicLocation("Gurgaon, Haryana"), "Gurgaon, India")
        assert.equal(resolveDynamicLocation("Looking for developers in Gurugram"), "Gurgaon, India")
        assert.equal(resolveDynamicLocation("Noida / Delhi NCR"), "Delhi NCR, India")
        assert.equal(resolveDynamicLocation("Bengaluru / Bangalore Office"), "Bengaluru, India")
        assert.equal(resolveDynamicLocation("Remote worldwide"), "India (Open to Remote Worldwide)")
        assert.equal(resolveDynamicLocation(undefined), "Bengaluru, India")
    })

    it("prioritizes Navix proof points for browser & automation roles", () => {
        const context = buildCandidateContextForQwen({
            company: "Browserbase",
            role: "Browser Automation Engineer",
        })
        assert.ok(context.includes("Navix"), "Should cite Navix for automation/browser roles")
        assert.ok(context.includes("17,000 tokens"), "Should cite token optimization metric")
        assert.ok(context.includes("NEVER mention GPA"), "Should enforce no GPA rule")
    })

    it("prioritizes Musketeers proof points for cloud & sandbox roles", () => {
        const context = buildCandidateContextForQwen({
            company: "Daytona",
            role: "Cloud Systems Engineer",
        })
        assert.ok(context.includes("Musketeers"), "Should cite Musketeers for sandbox roles")
        assert.ok(context.includes("XFCE4"), "Should cite XFCE4 desktop GUI")
    })

    it("prioritizes Liveblocks & React Flow proof points for frontend & multiplayer roles", () => {
        const context = buildCandidateContextForQwen({
            company: "Linear",
            role: "Frontend Engineer (React)",
        })
        assert.ok(context.includes("Orcha"), "Should cite visual workflow and canvas tools")
        assert.ok(context.includes("React Flow"), "Should cite React Flow")
    })

    it("contains lean macro summary with exact values for form inputs", () => {
        assert.ok(DEFAULT_CANDIDATE_MACRO_SUMMARY.includes("anuurag.devv@gmail.com"))
        assert.ok(DEFAULT_CANDIDATE_MACRO_SUMMARY.includes("+91 7275256535"))
        assert.ok(DEFAULT_CANDIDATE_MACRO_SUMMARY.includes("https://starter-pack-iota.vercel.app/"))
        assert.ok(DEFAULT_CANDIDATE_MACRO_SUMMARY.includes("Immediate joiner"))
        assert.ok(DEFAULT_CANDIDATE_MACRO_SUMMARY.includes("formDelegation"))
    })
})
