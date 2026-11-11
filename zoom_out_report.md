# Stage 5 (Initial Zoom Out Review) Report

**Target:** `d:\navix\docs\designs\funded-startup-outreach-engine.md` (`lines 1..287`)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |
| `egm-inventive-catalyst` | completed |

## Severity Summary

* 🔴 **Blocker**: 2
* 🟡 **Major**: 3
* 🟢 **Nit**: 2

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Graph Execution Mismatch: Array Output vs Scalar Workflow DAG Runner - Severity: Blocker
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Lines 77–98, 180–204, 276–285 (`Technical Plan`, `Array Handling in Navix DAG Execution`, and `Phase 5`)
* **Discrepancy Description**:
  The design specifies contradictory execution models. The Architecture diagram (lines 77–98) and Phase 5 template DAG (lines 276–285) define a linear chain of visual canvas nodes where `extract` feeds an array of startups into individual sequential nodes (`enrich-executive` -> `agent` -> `synthesize-pitch` -> `airtable`). However, Navix's core workflow execution runner (`features/workflows/tasks/run-workflow.ts`) operates on scalar inputs and outputs via topological sort and variable interpolation (`{{ node_id.output }}`).
  Lines 198–204 acknowledge this limitation and propose an internal loop or composite batch action (`enrich-and-stage-pitches`), while Alternative 4 explicitly rejects adding a DAG for-each iteration primitive. This leaves an architectural dead-end: the document defines two scalar canvas nodes (`enrich-executive`, `synthesize-pitch`) and an end-to-end template DAG that cannot execute on array data without engine-level graph loops.
* **Rationale & Recommendation**:
  Reconcile the graph topology with Navix's execution engine before implementing Phase 3. If `run-workflow.ts` does not support array mapping or loop edges:
  1. Replace the individual scalar nodes and multi-step template DAG in Phases 3–5 with a single composite batch executor (`enrich-and-stage-startups`) that iterates over the extracted array internally; or
  2. Implement an out-of-graph Trigger.dev fan-out pattern where the extractor task triggers independent single-startup child workflow runs via `batchTrigger`.

---

### 2. Unmapped Outbound Staging in Workflow Airtable Node - Severity: Blocker
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Lines 94–96, 170–178, 234–245, 284 (`Architecture Diagram`, `Phase 1`, and `Phase 5: Step 6`)
* **Discrepancy Description**:
  Phase 1 creates a standalone data access service `lib/airtable/outbound-service.ts` for the `Outbound Pitches` table schema. However, Phase 5 specifies using the existing canvas node `airtable` to stage pitches (`airtable: Stages leads into the 'Outbound Pitches' base with status 'Pending Review'`).
  In the current codebase (`features/workflows/nodes/airtable.ts` and `node-registry.ts`), the `airtable` action node is strictly hardcoded to the Job Application Tracker schema (`company`, `jobTitle`, `jobUrl`, `status`, `evidence`, etc.). It contains no fields or execution logic for `OutboundPitchFields` (`Executive Name`, `Executive Email`, `Draft Subject`, `Draft Body`, `Alternative Angles`, `Funding Round`, etc.). Furthermore, the Detailed Implementation Plan lacks any task to update `features/workflows/nodes/airtable.ts` or `node-registry.ts` to support outbound pitch staging.
* **Rationale & Recommendation**:
  Add an explicit implementation task in Phase 1 or Phase 3 to bridge `outbound-service.ts` to the workflow engine. Either update `features/workflows/nodes/airtable.ts` and `node-registry.ts` to support an `outbound-pitch` operation mode with appropriate input mappings, or introduce a dedicated `stage-outbound-pitch` action node following the Navix 3-file contract.

---

### 3. Monolithic Batch Executor Sacrifices Step Observability - Severity: Major
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** Lines 198–204, 223–227 (`Array Handling in Navix DAG Execution`, `Alternative 4`)
* **Discrepancy Description**:
  The document accepts a false compromise to bypass engine-level graph iteration: collapsing deduplication, Apollo enrichment, landing page profiling, pitch synthesis, and Airtable staging into a single opaque batch node (`enrich-and-stage-pitches`). This surrenders the core architectural value of Navix as an observable visual workflow platform, hiding intermediate outputs, preventing step-level retries for individual startups, and preventing inspection of intermediate LLM prompts or enrichment failures on the canvas.
* **Rationale & Recommendation (TRIZ Pattern 1: Segmentation & Pattern 8: Intermediary)**:
  Use Trigger.dev's native task composition (`@trigger.dev/sdk`) as an intermediary dispatcher. Keep the extraction node lightweight in the DAG, then dispatch child tasks (`outreach-startup-lead`) per startup using Trigger.dev's `batchTrigger`. Each child task runs an isolated single-startup pipeline, maintaining individual step logs, isolated retry backoffs for rate-limited APIs (Apollo/Groq/Gemini), and clean telemetry without requiring modifications to the React Flow DAG runner.
  *Secondary Operational Trade-off*: Increases total concurrent Trigger.dev task executions, requiring task queue concurrency limits to avoid exhausting Apollo or LLM provider rate limits.

---

### 4. Excessive Overhead in Autonomous Browser Agent for Landing Page Profiling - Severity: Major
* **Reviewer Lens:** `egm-zoom-out` & `egm-inventive-catalyst`
* **Affected Scope:** Lines 88, 282 (`Architecture Diagram` and `Phase 5: Step 4`)
* **Discrepancy Description**:
  Phase 5 routes each extracted startup domain to the `agent` workflow node (`agent: Profiles the startup landing page for product and tech problem context`). In Navix, the `agent` node launches a multi-step Browserbase/Stagehand browser agent with an LLM action loop of up to 50 steps (`maxSteps`), designed for complex interactive form filling.
  Running this interactive browser agent sequentially across 10–15 startups per article introduces severe latency (10–20 minutes total runtime), consumes excessive Browserbase session minutes, and burns LLM tokens for what is fundamentally a static reading task.
* **Rationale & Recommendation (TRIZ Pattern 3: Preliminary Action & Pattern 10: Cheap Dispensables)**:
  1. *Preliminary Action*: Extract startup descriptions, target markets, and funding context directly from the Inc42 article text during the initial extraction step—tech funding news articles already summarize 80% of the relevant technical proposition.
  2. *Cheap Dispensables*: If additional homepage context is necessary, replace the heavy interactive `agent` node with a lightweight HTTP reader (e.g., standard `fetch` + meta-tag extraction) or a single-shot Stagehand `extract` call without multi-step autonomous navigation.
  *Secondary Operational Trade-off*: Static HTTP fetch will not render dynamic client-side single-page applications (SPAs) that omit server-side rendering or OpenGraph meta tags.

---

### 5. Binary Enrichment Filter Discards Viable Leads - Severity: Major
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** Lines 51–53, 187, 250 (`Open Question 2`, `enrich-executive Node`)
* **Discrepancy Description**:
  The design accepts an unexamined trade-off: if Apollo returns an email confidence score below 80% or no verified email address, the provider returns `'none'`, and Open Question 2 considers halting downstream processing entirely. This discards newly funded companies where the decision-maker and LinkedIn profile were successfully discovered, wasting discovery and deduplication effort.
* **Rationale & Recommendation (TRIZ Pattern 4: Beforehand Cushioning & Pattern 7: Blessing in Disguise)**:
  Do not discard leads lacking verified emails. When Apollo resolves an executive name and LinkedIn URL without an email, stage the lead in Airtable with status `Missing Email (LinkedIn Staged)` and synthesize a 300-character LinkedIn connection note instead of an email draft. This converts an email-enrichment limitation into a functional secondary outreach channel.
  *Secondary Operational Trade-off*: Requires the Airtable schema and pitch synthesis prompt to support dual outreach channels (email body vs short LinkedIn connection note).

---

### 6. Speculative Hunter.io Abstraction Violates YAGNI - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Lines 11, 35, 118 (`Overview`, `Goals`, and `EnrichedExecutive Contract`)
* **Discrepancy Description**:
  The document references Hunter (`Apollo/Hunter`) and defines `provider: "apollo" | "hunter" | "none"` in the TypeScript contract. However, Phase 2, environment variables (`APOLLO_API_KEY`), and client implementation (`apollo-client.ts`) only implement Apollo. No Hunter integration, API key, or client code is planned.
* **Rationale & Recommendation**:
  Per the Zoom Out Standard (Section 2: Simplicity & Extensibility / YAGNI), eliminate speculative multi-provider references and simplify `provider` to `"apollo" | "none"` until a second enrichment provider is actively scheduled.

---

### 7. Premature Implementation Details in High-Altitude Architecture - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Lines 102–178 (`Data Contracts & TypeScript Interfaces`)
* **Discrepancy Description**:
  The high-altitude Technical Plan includes 76 lines of concrete TypeScript interface declarations (`ExecutiveSearchOptions`, `CandidateProfile`, `PitchSynthesisInput`, `OutboundPitchFields`) before system boundaries, graph data flow, and error states are fully defined.
* **Rationale & Recommendation**:
  Per the Zoom Out Standard (Section 3: Anti-Weeds), high-level sections should focus on architectural topology, component boundaries, and data flows. Relocate detailed TypeScript interfaces into the Detailed Implementation Plan (Phases 1–4) or an appendix.
