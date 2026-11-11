# Critic Review Report: Funded Startup Lead Generation & Outreach Engine

**Target:** `d:\navix\docs\designs\funded-startup-outreach-engine.md` (`lines 1..229`)  
**Standard:** `resources/document_standards/feature-spec-standard.md`  
**Generated:** 2026-11-10  

## Reviewer Status

| Reviewer | Status | Focus Lenses |
| :--- | :--- | :--- |
| `egm-design` | completed | System architecture, scalability, rate limits, security & prompt injection |
| `egm-structural` | completed | Heading hierarchy, template compliance, required sections, alternatives rule |
| `egm-style` | completed | Objectivity, precision, claim calibration (`DROP`/`CALIBRATE`/`RELOCATE`/`KEEP`) |

---

## Severity Summary

* 🔴 **Blocker**: 2
* 🟡 **Major**: 4
* 🟢 **Nit**: 3

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Missing Mandatory "Risks & Mitigations" Section - Severity: Blocker
* **Reviewer Lens:** `egm-structural` / `egm-design`
* **Affected Scope:** Document-level structure (`lines 1..229`)
* **Discrepancy Description**: The specification completely omits a dedicated `Risks & Mitigations` (or `Risks & Limits`) section, which is explicitly mandated by the Feature Specification Standard (`feature-spec-standard.md`, lines 23-27 & 38-39). While high-level problem motivations (e.g. bounce rates and spam flagging) are mentioned in "The Problem" (`lines 24-28`), the technical architecture fails to document and mitigate its own internal operational, scalability, and security risks.
* **Rationale & Recommendation**: Add an explicit `## Risks & Mitigations` section. This section must identify:
  1. API rate limits and backoff mitigation (Airtable 5 QPS, Apollo credit/rate ceilings).
  2. Failure isolation when third-party APIs or website DOM extractors change or fail.
  3. LLM prompt injection and hallucination safeguards.
  4. Cold outreach compliance considerations.

---

### 2. Architectural Contradiction: Multi-Node DAG vs. Array Batch Composite Node - Severity: Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `Lines 77–98` (`### High-Level Architecture & Subsystem Boundaries`) vs. `Lines 198–204` (`### Array Handling in Navix DAG Execution`) and `Lines 223–226` (`### Alternative 4`)
* **Discrepancy Description**: The design presents two contradictory execution models for array processing:
  1. The Mermaid flowchart (`lines 77-98`), the contracts section (`lines 180-197`), and Phase 3–5 propose discrete DAG nodes (`open-url` -> `extract` -> `enrich-executive` -> `agent` -> `synthesize-pitch` -> `airtable`).
  2. `Lines 198-204` explicitly state that the Navix workflow runner (`run-workflow.ts`) does not support array iteration between nodes and only supports scalar inputs/outputs. To circumvent this, it proposes encapsulating the entire loop inside a single composite batch executor (`enrich-and-stage-pitches`), which eliminates discrete `enrich-executive` and `synthesize-pitch` nodes from the DAG canvas.
* **Rationale & Recommendation**: Clarify the system design. If Navix cannot pass array items between individual DAG nodes on the canvas, define whether `enrich-executive` and `synthesize-pitch` are reusable internal library modules invoked within a single batch task (`enrich-and-stage-pitches`), or whether the workflow runner is being extended. Update the Mermaid diagram and node integration contracts to eliminate this architectural contradiction.

---

### 3. Unmitigated Prompt Injection Vulnerability in Scraped Landing Page Profiling - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `Line 88` (`ProfileNode`) and `Lines 138–141` (`PitchSynthesisInput.productSummary`)
* **Discrepancy Description**: Startup landing page DOM text is scraped via browser automation (`agent Node`) and passed directly into `PitchSynthesisInput.productSummary`, which is concatenated into the LLM synthesis prompt. The specification does not define any input sanitization, token truncations, or prompt boundary fencing for untrusted third-party web content. Malicious landing pages could execute indirect prompt injection to alter outreach email contents or exfiltrate candidate data.
* **Rationale & Recommendation**: Introduce input validation and prompt sanitization in `features/workflows/nodes/synthesize-pitch.ts`. Explicitly mandate delimiter fencing (e.g., XML tags `<company_context>...</company_context>`), token clamping, and instruction-stripping before passing scraped summaries into the LLM context.

---

### 4. Missing Rate Limiting and Backoff Strategies for Apollo and Airtable APIs - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `Lines 85–95`, `Lines 102–120` (`lib/enrichment/types.ts`), and `Lines 151–178` (`lib/airtable/outbound-types.ts`)
* **Discrepancy Description**: When batch-processing an array of 5–15 startups, the executor initiates rapid sequential or concurrent queries to Apollo and Airtable. Airtable enforces a strict global rate limit of 5 requests per second per base (triggering a 30-second 429 lockout upon breach), and Apollo enforces per-minute credit and request thresholds. The architecture specifies no client-side rate limiter, concurrency pool, or exponential backoff retry mechanism.
* **Rationale & Recommendation**: Specify an explicit rate-limiting mechanism (e.g., queue throttling <= 4 req/sec for Airtable) and retry logic with jittered exponential backoff in `lib/airtable/outbound-service.ts` and `lib/enrichment/apollo-client.ts`.

---

### 5. Violation of "The Alternatives Rule" on Attributing Rejections to Authority - Severity: Major
* **Reviewer Lens:** `egm-structural` / `egm-style`
* **Affected Scope:** `Lines 211, 216, 221, 226` (`## Alternatives Considered`)
* **Discrepancy Description**: All four alternatives preface their rejection rationale with `Rejected by author:`. The Feature Specification Standard (`feature-spec-standard.md`, lines 19-21) strictly states: *"Rejection rationales must state concrete technical or scope trade-offs and must not attribute a rejection to a maintainer without linking their issue, discussion, or PR."*
* **Rationale & Recommendation**: `CALIBRATE`: Remove the `Rejected by author:` prefix across all four alternatives. State the concrete technical, operational, and architectural trade-offs directly without personal attribution.

---

### 6. Uncalibrated and Emotive Phrasing in Problem Statement and Alternatives - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** `Lines 24–26`, `Line 29`, `Line 215`, `Line 220` (`## The Problem`, `## Alternatives Considered`)
* **Discrepancy Description**: Phrasing contains uncalibrated hyperbole and non-factual claims:
  * `Line 24`: "Attempting to automate this blindly..."
  * `Lines 25–26`: "...permanently destroying sender credibility."
  * `Line 29`: "...giving the user a 10-second review checkpoint..."
  * `Line 215`: "...permanently burn executive relationships."
  * `Line 220`: "...guaranteeing instant rejection."
* **Rationale & Recommendation**: `CALIBRATE` each statement into objective technical language:
  * Replace "blindly" with "without human review gates".
  * Replace "permanently destroying / burn" with "severely degrading domain reputation and deliverability metrics".
  * Replace "10-second review checkpoint" with "streamlined human review gate".
  * Replace "guaranteeing instant rejection" with "significantly increasing rejection rates".

---

### 7. Non-Technical Process Requirement Listed as a System Goal - Severity: Nit
* **Reviewer Lens:** `egm-style` / `egm-structural`
* **Affected Scope:** `Line 39` (`## Goals`)
* **Discrepancy Description**: Goal 7 states: *"Modular Phase-by-Phase Implementation: Enforce clean repository commit boundaries across 5 isolated, testable pull requests."* PR commit cadence and branch management are engineering workflow processes, not functional capabilities of the outreach engine.
* **Rationale & Recommendation**: `RELOCATE`: Move repository commit boundaries and PR staging to the Implementation Plan or pull request description. Limit the `Goals` section to user and system capabilities.

---

### 8. Structural Asymmetry in Sub-Heading Numbering - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** `Lines 100–197`
* **Discrepancy Description**: Under `### Data Contracts & TypeScript Interfaces`, subsections use numeric headings (`#### 1. Executive Enrichment Contract`), whereas under `### Workflow Node Integration`, subsections use prefixed identifiers (`#### Node 1: enrich-executive`).
* **Rationale & Recommendation**: Standardize sub-heading naming conventions across technical architecture subsections to ensure structural uniformity.

---

### 9. Inconsistent Markdown Horizontal Rule Delimiters - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** `Lines 7, 66, 228`
* **Discrepancy Description**: Horizontal divider rules (`---`) appear inconsistently between some H2 sections (after metadata, after CUJs, after Alternatives) while being omitted between others (Overview, Problem, Goals, Non-Goals, Open Questions).
* **Rationale & Recommendation**: Standardize section division either by consistently using standard Markdown header spacing throughout or by placing horizontal rules before every H2 section.
