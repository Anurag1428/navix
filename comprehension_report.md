# Stage 6 (Comprehension Test) Report

**Target:** `d:\navix\docs\designs\funded-startup-outreach-engine.md` (`lines 1..286`)

## What the Document Proposes

The document proposes an automated lead generation and outreach workflow pipeline in Navix that extracts newly funded startups from Inc42 articles, profiles their product domains, and resolves verified technical decision-maker contact details (CTO or CEO) using B2B enrichment APIs (Apollo). It synthesizes personalized, concise peer-to-peer cold outreach pitch drafts based on a candidate's technical profile and stages the leads into an Airtable table (`Outbound Pitches`) with status `Pending Review` for human approval before dispatch. The feature is planned across five sequential pull requests, adding two new workflow nodes (`enrich-executive` and `synthesize-pitch`) and using a batch execution pattern to process multi-company lists within Navix's existing runner architecture.

## How the System Works Today, According to the Document

According to the document, job seekers currently spend 30 to 45 minutes per company manually discovering funded startups, researching executives, finding email addresses, and drafting cold outreach messages. Navix's existing workflow execution engine (`run-workflow.ts`), backed by Trigger.dev, executes DAG tasks operating strictly on scalar inputs and outputs without native graph-level looping primitives. The platform already includes browser automation nodes powered by Stagehand and Browserbase (`open-url`, `extract`, `agent`) and an existing Airtable integration with candidate tracking schemas, governed by a standardized 3-file convention for registering new workflow action nodes (`features/workflows/nodes/`).

---

### Comprehension Gaps & Technical Clarity Findings

#### 1. 🔴 Blocker: Architectural Contradiction Between Array Execution and Template DAG
* **Affected Scope**: Lines 77–98 (High-Level Architecture Diagram), Lines 198–204 (Array Handling in Navix DAG Execution), Lines 223–226 (Alternative 4), and Lines 277–285 (Phase 5 Template DAG).
* **Discrepancy Description & Rationale**:
  The document introduces a fundamental architectural contradiction regarding how multiple startups extracted from a single Inc42 article are processed:
  - In *Array Handling* (lines 198–204) and *Alternative 4* (lines 223–226), the document explains that Navix's core runner (`run-workflow.ts`) only supports scalar values and rejects engine-level for-each loops. It specifies that array processing is handled via a composite batch action (`enrich-and-stage-pitches`) that loops through items internally.
  - However, in the *Architecture Diagram* (lines 77–98), the *3-File Contract* (lines 180–197), and the *Detailed Implementation Plan* (Phases 3, 4, and 5; lines 256–285), this composite batch action does not exist. Instead, the design specifies discrete, single-entity nodes (`enrich-executive` accepting `domain: string`, and `synthesize-pitch`), and defines the Phase 5 template DAG as a linear sequence: `open-url` $\to$ `extract` $\to$ `enrich-executive` $\to$ `agent` $\to$ `synthesize-pitch` $\to$ `airtable`.
  
  A developer cannot implement this plan: if `run-workflow.ts` only passes scalar data, piping an array of 5–15 startups from `extract` directly into scalar nodes will fail at runtime. The document must explicitly clarify whether Phase 3–5 implements individual nodes with an engine-level adapter or a consolidated batch executor (`enrich-and-stage-pitches`).

#### 2. 🟡 Major: Undefined and Dangling External Integration: "Hunter"
* **Affected Scope**: Line 11 (Overview), Line 35 (Goals), Line 118 (`EnrichedExecutive`), and Line 250 (Phase 2).
* **Discrepancy Description & Rationale**:
  The document frequently references Hunter alongside Apollo ("Apollo/Hunter", and `provider: "apollo" | "hunter" | "none"`). However, Hunter is completely absent from the technical design: Phase 2 only implements `apollo-client.ts`, `.env.example` only adds `APOLLO_API_KEY`, and there is no Hunter client, fallback logic, or configuration described. To a fresh reader, it is ambiguous whether Hunter is an unstated dependency, a planned fallback provider, or legacy copy that should be removed.

#### 3. 🟡 Major: Phantom Notification Subsystem (Telegram / WhatsApp)
* **Affected Scope**: Line 75 (High-Level Architecture) and Line 96 (Mermaid Diagram).
* **Discrepancy Description & Rationale**:
  Line 75 notes "optional completion notifications via Telegram/WhatsApp", and the Mermaid diagram includes `NotifyNode["telegram/whatsapp Node (Deep Link to Airtable)"]`. However, notifications are omitted from the five delivery phases in the Overview (lines 13–19), the node registry additions (lines 180–197), and the Detailed Implementation Plan (lines 230–286). The reader cannot determine whether Telegram/WhatsApp nodes already exist in Navix, are planned for a subsequent phase, or represent extraneous diagram elements.

#### 4. 🟡 Major: Unresolved Origin and Injection of Candidate Profile Data
* **Affected Scope**: Line 51 (Open Question 1), Lines 124–130 (`CandidateProfile`), Line 140 (`PitchSynthesisInput`), and Lines 268–270 (Phase 4).
* **Discrepancy Description & Rationale**:
  The `synthesize-pitch` node strictly requires a `candidate: CandidateProfile` object containing `name`, `title`, `coreSkills`, and `proofPoints`. Open Question 1 highlights that the system has not decided whether this profile comes from node inputs or an environment/user profile configuration. Phase 4 simply states that the executor consumes "candidate profile context" without resolving the question or specifying where this data is stored and how it is injected into the node in the Phase 5 template DAG (`funded-startup-outreach.json`).

#### 5. 🟡 Major: Unspecified Invocation Path for Deduplication (`checkDomainExists`)
* **Affected Scope**: Lines 86–87 (Architecture Diagram), Lines 237–240 (Phase 1), and Lines 277–285 (Phase 5).
* **Discrepancy Description & Rationale**:
  Deduplication prior to paid API lookups is identified as a primary goal (Goal 4, line 36). Phase 1 introduces `checkDomainExists(baseId, domain)`, and the Mermaid architecture diagram depicts `DedupCheck` as a decision branch between extraction and enrichment. However, in Phase 3 (`enrich-executive`) and Phase 5 (`funded-startup-outreach.json`), `checkDomainExists` is not integrated into any node executor or workflow step. The document does not describe which component invokes this check, how skipped domains are pruned from downstream processing, or how `baseId` is passed at runtime.

#### 6. 🟢 Nit: Unclarified Downstream Handling of Missing or Low-Confidence Emails
* **Affected Scope**: Line 52 (Open Question 2), Line 158 (`OutboundPitchStatus`), Lines 187 & 250 (Phase 2 & 3).
* **Discrepancy Description & Rationale**:
  When Apollo returns no email or confidence is <80%, `enrich-executive` returns `provider = 'none'`. However, Open Question 2 remains unresolved: the document does not explain what `synthesize-pitch` and `airtable` do when `provider = 'none'`. It is unclear whether pitch synthesis is bypassed and the record is staged with `Status = 'Missing Contact'` (which is present in the TypeScript enum), or if processing halts immediately.

#### 7. 🟢 Nit: Misleading Description of Cloud APIs as "Local LLMs"
* **Affected Scope**: Line 74 (High-Level Architecture).
* **Discrepancy Description & Rationale**:
  The text references "prompts local LLMs (Groq Qwen / Gemini Flash)". Groq and Gemini Flash are hosted cloud APIs, not local LLMs (e.g., Ollama or Llama.cpp). Describing them as "local" creates false assumptions about local host hardware requirements and offline inference capabilities.

#### 8. 🟢 Nit: Assumed Pre-existing Knowledge of the `agent` Node
* **Affected Scope**: Line 88 (Architecture Diagram) and Line 282 (Phase 5).
* **Discrepancy Description & Rationale**:
  Step 4 of the workflow DAG uses an `agent` node to profile the startup's landing page. While `extract` and `open-url` are briefly attributed to Stagehand/Browserbase, the `agent` node is not defined. The document assumes the reader already knows what the `agent` node is, how it accepts the company URL, and whether its output matches the `productSummary` string required by `synthesize-pitch`.
