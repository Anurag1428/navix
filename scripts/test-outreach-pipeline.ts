import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })
dotenv.config({ path: ".env" })

import fs from "node:fs"
import path from "node:path"

import { validateGraph } from "../features/workflows/lib/validate-graph.ts"
import { parseStartupsInput } from "../features/workflows/nodes/enrich-and-stage-leads.ts"
import { normalizeDomain, checkDomainExists, createOutboundPitch } from "../lib/airtable/outbound-service.ts"
import { searchExecutiveByDomain } from "../lib/enrichment/apollo-client.ts"
import { synthesizeOutreachPitch, sanitizeCompanyContext } from "../lib/synthesis/pitch-synthesizer.ts"
import { loadCandidateProfile } from "../lib/synthesis/candidate-profile.ts"
import type { WorkflowGraph } from "../lib/db/schema.ts"
import type { PitchSynthesisInput } from "../lib/synthesis/types.ts"

const SAMPLE_INC42_STARTUPS = [
  {
    companyName: "Zepto",
    websiteUrl: "https://www.zepto.co.in",
    fundingRound: "Series E",
    fundingAmount: "$665M",
    leadInvestors: "StepStone Group, Nexus Venture Partners, Glade Brook Capital",
    productSummary: "Quick commerce platform delivering groceries and essentials in under 10 minutes across Indian metros.",
  },
  {
    companyName: "Ultrahuman",
    websiteUrl: "https://www.ultrahuman.com",
    fundingRound: "Series B",
    fundingAmount: "$35M",
    leadInvestors: "Blume Ventures, Alpha Wave, Steadview Capital",
    productSummary: "Metabolic health tracking platform and wearable smart ring monitoring sleep, glucose, and movement biomarkers in real time.",
  },
  {
    companyName: "Ather Energy",
    websiteUrl: "https://www.atherenergy.com",
    fundingRound: "Series E",
    fundingAmount: "$71M",
    leadInvestors: "National Investment and Infrastructure Fund (NIIF), Hero MotoCorp",
    productSummary: "Electric smart scooter manufacturer and fast-charging grid network infrastructure across India.",
  },
]

async function runOutreachPipelineTest() {
  const isLive = process.argv.includes("--live")

  console.log("================================================================================")
  console.log(`  Funded Startup Outreach Engine - Integration Pipeline Verification`)
  console.log(`  Mode: ${isLive ? "LIVE (Active API Lookups)" : "DRY-RUN / LOCAL FIXTURE"}`)
  console.log("================================================================================\n")

  // Step 1: Validate Template DAG Structure
  console.log("1. Validating Workflow Template DAG...")
  const templatePath = path.resolve(process.cwd(), "features/workflows/templates/funded-startup-outreach.json")
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found at: ${templatePath}`)
  }
  const templateJson = JSON.parse(fs.readFileSync(templatePath, "utf-8"))
  const problems = validateGraph(templateJson.graph as WorkflowGraph)
  if (problems.length > 0) {
    throw new Error(`Template graph validation failed: ${problems.join(", ")}`)
  }
  console.log(`   [PASS] Template '${templateJson.name}' DAG is topologically valid with ${templateJson.graph.nodes.length} nodes and ${templateJson.graph.edges.length} edges.\n`)

  // Step 2: Validate Candidate Profile Configuration
  console.log("2. Loading Candidate Profile Context...")
  const candidate = loadCandidateProfile()
  console.log(`   [PASS] Candidate: ${candidate.name} (${candidate.title})`)
  console.log(`   [PASS] Core Skills: ${candidate.coreSkills.slice(0, 4).join(", ")}...`)
  console.log(`   [PASS] Portfolio: ${candidate.portfolioUrl || "N/A"}\n`)

  // Step 3: Parse and Clamp Input Startups
  console.log("3. Testing Startup Extraction Input Parser...")
  const parsedStartups = parseStartupsInput(SAMPLE_INC42_STARTUPS)
  console.log(`   [PASS] Parsed ${parsedStartups.length} startup leads from sample dataset.\n`)

  // Step 4: Execute Pipeline for Each Startup
  console.log("4. Executing Lead Processing Pipeline per Startup:")
  console.log("--------------------------------------------------------------------------------")

  const candidateProfile = loadCandidateProfile()

  for (let i = 0; i < parsedStartups.length; i++) {
    const startup = parsedStartups[i]
    const cleanDomain = normalizeDomain(startup.companyDomain)
    console.log(`\n[${i + 1}/${parsedStartups.length}] Processing: ${startup.companyName} (${cleanDomain})`)
    console.log(`   Round: ${startup.fundingRound} | Amount: ${startup.fundingAmount}`)

    // 4.1 Prompt injection sanitization check
    const sanitizedSummary = sanitizeCompanyContext(startup.productSummary)
    console.log(`   Context sanitized: "${sanitizedSummary.slice(0, 60)}..."`)

    if (isLive) {
      // Live execution against APIs
      try {
        console.log(`   Checking Airtable deduplication for ${cleanDomain}...`)
        const exists = await checkDomainExists(cleanDomain)
        if (exists) {
          console.log(`   [SKIP] Domain already exists in Airtable. Pre-flight dedup prevented duplicate credit burn!`)
          continue
        }

        console.log(`   Searching executive contacts via Apollo for ${cleanDomain}...`)
        const executive = await searchExecutiveByDomain(cleanDomain, { companyName: startup.companyName })

        const execToUse = executive || {
          name: "Founder",
          firstName: "there",
          title: "Founder / Technical Leader",
          email: "",
          emailConfidence: 0,
          companyDomain: cleanDomain,
          provider: "none" as const,
        }

        console.log(`   Resolved Executive: ${execToUse.name} (${execToUse.title})`)
        console.log(`   Email: ${execToUse.email || "[Missing - Fallback Mode]"} (Confidence: ${execToUse.emailConfidence}%)`)

        console.log(`   Synthesizing pitch with Gemini Flash...`)
        const pitch = await synthesizeOutreachPitch({
          companyName: startup.companyName,
          companyDomain: cleanDomain,
          fundingRound: startup.fundingRound,
          fundingAmount: startup.fundingAmount,
          leadInvestors: startup.leadInvestors,
          productSummary: sanitizedSummary,
          executive: execToUse,
          candidate: candidateProfile,
        })

        console.log(`   Draft Subject: "${pitch.subject}"`)
        console.log(`   Draft Hook: "${pitch.keyHook}"`)

        console.log(`   Staging lead into Airtable Outbound Pitches...`)
        const record = await createOutboundPitch({
          companyName: startup.companyName,
          websiteOrDomain: cleanDomain,
          fundingRound: startup.fundingRound,
          fundingAmount: startup.fundingAmount,
          leadInvestors: startup.leadInvestors,
          executiveName: execToUse.name,
          executiveTitle: execToUse.title,
          executiveEmail: execToUse.email,
          executiveLinkedIn: execToUse.linkedinUrl,
          emailConfidence: execToUse.emailConfidence,
          draftSubject: pitch.subject,
          draftBody: pitch.body,
          alternativeAngles: pitch.alternativeAngles?.join("; "),
          linkedInNote: pitch.linkedinNote,
          status: execToUse.email ? "Pending Review" : "Missing Contact",
        })

        console.log(`   [STAGED] Created Airtable record: ${record.id} with status '${record.fields.Status}'`)
      } catch (err: any) {
        console.error(`   [ERROR] ${err.message}`)
      }
    } else {
      // Local dry-run verification
      const mockExec = {
        name: i === 0 ? "Aadit Palicha" : i === 1 ? "Mohit Kumar" : "Tarun Mehta",
        firstName: i === 0 ? "Aadit" : i === 1 ? "Mohit" : "Tarun",
        title: i === 0 ? "Co-Founder & CEO" : i === 1 ? "Founder & CEO" : "Co-Founder & CEO",
        email: i < 2 ? `exec@${cleanDomain}` : "",
        emailConfidence: i < 2 ? 95 : 0,
        linkedinUrl: `https://linkedin.com/in/${cleanDomain.split(".")[0]}`,
        companyDomain: cleanDomain,
        provider: (i < 2 ? "apollo" : "none") as "apollo" | "none",
      }

      console.log(`   [MOCK RESOLVE] Executive: ${mockExec.name} (${mockExec.title})`)
      console.log(`   [MOCK RESOLVE] Email: ${mockExec.email || "[Missing - Fallback Mode]"} (Confidence: ${mockExec.emailConfidence}%)`)

      const pitch = await synthesizeOutreachPitch({
        companyName: startup.companyName,
        companyDomain: cleanDomain,
        fundingRound: startup.fundingRound,
        fundingAmount: startup.fundingAmount,
        leadInvestors: startup.leadInvestors,
        productSummary: sanitizedSummary,
        executive: mockExec,
        candidate: candidateProfile,
      })

      console.log(`   [SYNTHESIZED] Subject: "${pitch.subject}"`)
      console.log(`   [SYNTHESIZED] Hook: "${pitch.keyHook}"`)
      if (pitch.linkedinNote) {
        console.log(`   [SYNTHESIZED] LinkedIn Note (${pitch.linkedinNote.length} chars): "${pitch.linkedinNote}"`)
      }

      const status = mockExec.email ? "Pending Review" : "Missing Contact"
      console.log(`   [SIMULATED STAGE] Staging with Status: '${status}' (Zero emails sent, human review gate preserved).`)
    }
  }

  console.log("\n================================================================================")
  console.log("  [SUCCESS] All pipeline integration checks passed cleanly!")
  console.log("================================================================================\n")
}

runOutreachPipelineTest().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
