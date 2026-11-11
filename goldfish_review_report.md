# Goldfish Annotated Review Report

**Target:** `docs/designs/funded-startup-outreach-engine.md` (`lines 1..286`)  
**Status:** resolved  
**Date:** 2026-11-11  

---

## Resolution Summary
All 15 findings have been reviewed and applied to `docs/designs/funded-startup-outreach-engine.md`:
* Item 1 (Blocker): Replaced scalar canvas action chain with compound `enrich-and-stage-leads` action node and Trigger.dev `processStartupLeadTask` child task fan-out.
* Item 2 (Blocker): Explicitly connected `outbound-service.ts` to `enrich-and-stage-leads`.
* Item 3 (Blocker): Added mandatory `## Risks & Mitigations` section covering rate limits, prompt injection, and credit caps.
* Item 4 (Blocker): Defined Gemini Flash (`@google/genai`), prompt constraints, and structured Zod outputs.
* Items 5–15: Updated 5-phase plan, removed speculative dependencies, added XML prompt fencing, clarified fallback logic.

## Prioritized Findings & AI Suggestions

### 1. Graph Execution Mismatch & Dead-End Topology [`egm-zoom-out` / `egm-implementation-readiness`] - Severity: Blocker
*   **Affected Scope:** Lines 77–98 (`High-Level Architecture`), Lines 198–204 (`Array Handling`), Lines 256–285 (`Phases 3–5`)
*   **Discrepancy Description:** Navix's core workflow runner (`run-workflow.ts`) operates on scalar values and executes each node once. Chaining `extract` (which yields an array of 5–15 startups) into discrete canvas action nodes (`enrich-executive`, `synthesize-pitch`) fails at runtime.
*   **Rationale:** The document previously proposed an internal batch loop (`enrich-and-stage-pitches`), but Phase 3–5 defined discrete scalar nodes instead.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Consolidating downstream extraction processing into a single array-aware batch action node (`enrich-and-stage-leads`) eliminates phantom canvas nodes, preserves Navix's existing runner architecture without engine rewrites, and enables per-startup error isolation.
*   ***Proposed Edit:***
    *   Location: `## Technical Plan` and `## Detailed Implementation Plan`
    *   Change: Replace separate `enrich-executive` and `synthesize-pitch` canvas nodes with modular services in `lib/` and register a single batch action node `features/workflows/nodes/enrich-and-stage-leads.ts`. Update the Phase 5 template DAG to: `open-url` $\to$ `extract` $\to$ `enrich-and-stage-leads`.

---

### 2. Missing Action Node Bridge for Outbound Pitches [`egm-zoom-out` / `egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** Lines 94–96, Lines 237–245, Line 284
*   **Discrepancy Description:** The existing `airtable` action node is strictly tied to candidate job applications (`JobApplicationFields`) and cannot ingest `OutboundPitchFields`. The implementation plan had no tasks to connect `outbound-service.ts` to the workflow engine.
*   **Rationale:** Overloading the existing job tracker node creates schema pollution and breaks existing job application workflows.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Have the consolidated batch action node (`enrich-and-stage-leads`) import and invoke `lib/airtable/outbound-service.ts` directly, bypassing the job-tracker `airtable` node.
*   ***Proposed Edit:***
    *   Location: `## Technical Plan` and `Phase 1 / Phase 3`
    *   Change: Explicitly document that `enrich-and-stage-leads` calls `createOutboundPitch` and `checkDomainExists` from `lib/airtable/outbound-service.ts`.

---

### 3. Missing Mandatory "Risks & Mitigations" Section [`egm-structural` / `egm-design`] - Severity: Blocker
*   **Affected Scope:** Document-level structure (`lines 1..229`)
*   **Discrepancy Description:** The specification lacks an explicit `## Risks & Mitigations` section required by the Feature Specification Standard.
*   **Rationale:** System risks (rate limits, indirect prompt injection, scraping failures) must be documented alongside architectural mitigations.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Adding the section ensures compliance with the document standard and establishes clear operational guardrails.
*   ***Proposed Edit:***
    *   Location: Insert before `## Alternatives Considered`
    *   Change: Add `## Risks & Mitigations` covering Airtable 5 QPS limits, Apollo credit caps, prompt injection fencing, and failure isolation.

---

### 4. Unspecified LLM Invocation in Pitch Synthesis [`egm-implementation-readiness`] - Severity: Blocker
*   **Affected Scope:** Lines 266–275 (Phase 4)
*   **Discrepancy Description:** Phase 4 specifies generating pitches with an LLM, but omits the SDK, model name, JSON schema validation, and required environment variables.
*   **Rationale:** An implementer cannot write the code without knowing which LLM client and model to invoke.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Specify `@google/genai` with `gemini-2.5-flash` (or Groq SDK), structured Zod output validation, and document `GEMINI_API_KEY` in `.env.example`.
*   ***Proposed Edit:***
    *   Location: `Phase 4: Pitch Synthesis Service & Batch Logic`
    *   Change: Explicitly detail `@google/genai`, model `gemini-2.5-flash`, schema validation using `zod`, and add `GEMINI_API_KEY` to `.env.example`.

---

### 5. TypeScript Manifest Contract Violations in Node Registration [`egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** Lines 259–262 and Lines 269–272
*   **Discrepancy Description:** Registry specifications used invalid `kind: "enrichExecutive"` and an unaccepted `category` property, with mismatched camelCase executor keys.
*   **Rationale:** In `node-registry.ts`, `kind` must be `"action"` and node types are kebab-case strings.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Conforming to `NodeDefinition` prevents compile-time TypeScript errors.
*   ***Proposed Edit:***
    *   Location: `Phase 3: The Custom Navix Workflow Node`
    *   Change: Specify `type: "enrich-and-stage-leads"`, `kind: "action"`, remove `category`, and map `"enrich-and-stage-leads"` in `node-executors.ts`.

---

### 6. Unmitigated Indirect Prompt Injection on Scraped Content [`egm-design`] - Severity: Major
*   **Affected Scope:** Line 88, Lines 138–141
*   **Discrepancy Description:** Scraped landing page text is passed directly into the LLM synthesis prompt without boundary fencing or token clamping.
*   **Rationale:** Malicious or malformed landing page copy could hijack the prompt to alter email contents or exfiltrate candidate data.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Wrap untrusted web content in XML delimiter tags (`<company_context>...</company_context>`) and clamp to 1,000 tokens before prompt injection.
*   ***Proposed Edit:***
    *   Location: `## Risks & Mitigations` and `Phase 4`
    *   Change: Add strict delimiter fencing and token truncation specifications.

---

### 7. Excessive Browser Agent Overhead for Landing Page Profiling [`egm-zoom-out` / `egm-inventive-catalyst`] - Severity: Major
*   **Affected Scope:** Line 88, Line 282
*   **Discrepancy Description:** Spawning a 50-step Browserbase `agent` node for 15 startups per article adds 10–20 minutes of latency and high session costs.
*   **Rationale:** Tech funding news articles already summarize 80% of the company's product; static landing pages do not need multi-step interactive browsing.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Extract company descriptions directly from the Inc42 article text during the `extract` step, with an optional lightweight HTTP fetch fallback (`fetchLandingPageSummary`) without launching Browserbase sessions.
*   ***Proposed Edit:***
    *   Location: `## Technical Plan` and `Phase 5`
    *   Change: Update `extract` schema to include `summary`, eliminating the separate Browserbase `agent` node.

---

### 8. Binary Enrichment Discards Viable Leads (Open Question 2) [`egm-inventive-catalyst` / `egm-zoom-out`] - Severity: Major
*   **Affected Scope:** Lines 51–53, Line 187, Line 250
*   **Discrepancy Description:** If Apollo returns an executive and LinkedIn URL but no verified corporate email, discarding the lead drops viable outreach opportunities.
*   **Rationale:** The candidate can still connect on LinkedIn.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** When email confidence is <80% or missing, stage the lead in Airtable with `Status = 'Missing Contact'` and generate a 300-character LinkedIn connection note in `Draft Body`.
*   ***Proposed Edit:***
    *   Location: `## Open Questions` (resolve Question 2) and `Phase 2`
    *   Change: Document the fallback to `Missing Contact` with LinkedIn connection note generation.

---

### 9. Airtable 5 QPS Rate Limiting & Batch Dedup [`egm-design` / `egm-zoom-out`] - Severity: Major
*   **Affected Scope:** Lines 85–95, Lines 237–240
*   **Discrepancy Description:** Firing 15 sequential domain lookup queries breaches Airtable's 5 RPS limit, triggering 30-second 429 lockouts.
*   **Rationale:** API rate limits must be respected at the client layer.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Batch deduplication domain queries into single `filterByFormula` requests with `OR(...)` and enforce client-side queue throttling (max 4 req/sec) with jittered exponential backoff.
*   ***Proposed Edit:***
    *   Location: `Phase 1: lib/airtable/outbound-service.ts`
    *   Change: Add queue throttling (4 RPS) and batched domain checking.

---

### 10. Unresolved Candidate Profile Injection (Open Question 1) [`egm-comprehension` / `egm-zoom-out`] - Severity: Major
*   **Affected Scope:** Lines 49–51, Lines 124–130, Lines 267–268
*   **Discrepancy Description:** The design left Open Question 1 open regarding where candidate profile data originates.
*   **Rationale:** The implementer must know where candidate context is loaded at runtime.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Store the default candidate profile in environment variables (`CANDIDATE_NAME`, `CANDIDATE_TITLE`, `CANDIDATE_CORE_SKILLS`, `CANDIDATE_PORTFOLIO_URL`) with optional node-level input overrides on the canvas.
*   ***Proposed Edit:***
    *   Location: `## Open Questions` (resolve Question 1) and `Phase 4`
    *   Change: Define environment configuration variables and node input overrides.

---

### 11. Testing Dissonance with Existing Airtable Client Architecture [`egm-codebase-details`] - Severity: Major
*   **Affected Scope:** Lines 241–242
*   **Discrepancy Description:** Phase 1 specifies "mocking the Airtable SDK", but Navix uses a custom REST client with `createMockFetch`.
*   **Rationale:** Mocking an external SDK that the project doesn't use breaks unit tests.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Align test specifications with `features/workflows/nodes/__tests__/airtable.test.ts` using `createMockFetch`.
*   ***Proposed Edit:***
    *   Location: `Phase 1: lib/airtable/__tests__/outbound-service.test.ts`
    *   Change: Replace "mocking the Airtable SDK" with "mocked HTTP fetch using `createMockFetch`".

---

### 12. Alternatives Attribution Rule Violation (`Rejected by author:`) [`egm-structural` / `egm-style`] - Severity: Major
*   **Affected Scope:** Lines 211, 216, 221, 226
*   **Discrepancy Description:** Rejections are prefaced with `Rejected by author:`, which violates the standard requiring objective trade-offs without personal attribution.
*   **Rationale:** Architectural specifications must stand on technical merits.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Remove `Rejected by author:` and state the technical trade-offs directly.
*   ***Proposed Edit:***
    *   Location: `## Alternatives Considered`
    *   Change: Delete `Rejected by author:` prefixes.

---

### 13. Uncalibrated / Emotive Phrasing in Problem & Alternatives [`egm-style`] - Severity: Major
*   **Affected Scope:** Lines 24–26, Line 29, Line 215, Line 220
*   **Discrepancy Description:** Uses ungrounded phrases like "blindly", "permanently destroying", "instant rejection".
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Calibrate language to objective technical engineering prose.
*   ***Proposed Edit:***
    *   Location: `## The Problem` and `## Alternatives Considered`
    *   Change: Replace with "without human review gates", "degrading domain reputation and deliverability metrics", "increasing rejection rates".

---

### 14. Purge Speculative Hunter.io References (YAGNI) [`egm-zoom-out`] - Severity: Nit
*   **Affected Scope:** Line 11, Line 35, Line 118
*   **Discrepancy Description:** Hunter is mentioned in text and contracts, but no client or API key is planned in any phase.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Eliminate speculative abstractions. Keep `provider: "apollo" | "none"` until a second provider is scheduled.
*   ***Proposed Edit:***
    *   Location: Document-wide
    *   Change: Remove "Hunter" references and simplify `provider` type.

---

### 15. Remove Phantom Notification Nodes from Architecture Diagram [`egm-zoom-out`] - Severity: Nit
*   **Affected Scope:** Line 75, Line 96
*   **Discrepancy Description:** Telegram/WhatsApp notifications appear in the diagram but are not part of the 5 phases.
*   ***AI Suggestion:*** `PROPOSE FIX`
*   ***Justification:** Keep the high-altitude diagram 100% aligned with the in-scope v1 implementation.
*   ***Proposed Edit:***
    *   Location: `## Technical Plan`
    *   Change: Remove `NotifyNode` from the Mermaid diagram.
