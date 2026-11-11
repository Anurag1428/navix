# Stage 9 Implementation Readiness Test Report

**Target:** `d:\navix\docs\designs\funded-startup-outreach-engine.md` (DetailedRange: lines 230..286)  
**Standard:** `resources/document_standards/implementation-readiness-standard.md`  
**Deliverable Path:** `d:\navix\implementation_readiness_report.md`  

---

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed |
| `egm-style` | completed |

## Severity Breakdown
- 🔴 **Blocker**: 3
- 🟡 **Major**: 6
- 🟢 **Nit**: 3
- **Total Findings**: 12

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Architectural Contradiction & Unexecutable Array Processing in Workflow DAG - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 256–285 (Phases 3, 4, 5) vs Architecture Lines 198–203 & Alternative 4 (Lines 223–226)
* **Discrepancy Description**: The Technical Plan (Section 2.3, lines 198–203) and Alternative 4 (lines 223–226) explicitly state that Navix's runner (`run-workflow.ts`) operates on scalar inputs and cannot execute engine-level loops, requiring downstream enrichment to be executed via a composite batch action (`enrich-and-stage-pitches`). However, the Detailed Implementation Plan completely discards this design: `enrich-and-stage-pitches` is never implemented. Instead, Phase 3 defines a scalar `enrich-executive` node, Phase 4 defines a scalar `synthesize-pitch` node, and Phase 5 defines a linear DAG template where `extract` (which outputs an array of 5–15 startup objects) connects directly to `enrich-executive` -> `agent` -> `synthesize-pitch` -> `airtable`.
* **Rationale & Recommendation**: In Navix's execution engine (`features/workflows/tasks/run-workflow.ts`), the DAG runner executes each node once with inputs resolved via scalar string interpolation (`interpolate(value, outputs)`). There is no native fan-out/map primitive. If an implementer follows Phase 3–5, the workflow will either fail at runtime or process only one stringified array object. The implementer is forced to make a major unstated architectural choice: either rewrite `run-workflow.ts` to support engine-level loops (which the design rejected), or invent the missing `enrich-and-stage-pitches` batch step.  
  *Recommendation*: Update Phase 3 and Phase 4 to define the composite batch executor (`features/workflows/nodes/enrich-and-stage-pitches.ts`) with explicit loop iteration, error isolation per startup, and telemetry logging, aligning with Section 2.3.

---

### 2. Unspecified LLM Invocation Architecture, Model, and Env Config in `synthesize-pitch.ts` - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 266–275 (Phase 4: Pitch Synthesis Workflow Node)
* **Discrepancy Description**: Phase 4 specifies that `synthesize-pitch.ts` "Formulates a constrained prompt to generate a personalized cold outreach email... and returns `subject`, `body`, and `alternativeAngles`", but fails to specify the underlying LLM invocation mechanism, SDK/provider, model name, output schema parser, or required environment variables.
* **Rationale & Recommendation**: Navix does not currently have a centralized LLM utility for workflow nodes. An implementer cannot execute Phase 4 without deciding:
  1. What SDK/client to use (e.g. `@google/genai`, Groq SDK, or OpenAI SDK).
  2. Which specific model to call (e.g. `gemini-2.5-flash`, `qwen-2.5-32b`).
  3. How structured JSON is enforced (e.g. Zod schema parser, structured outputs API).
  4. Which environment variables are required (Phase 4 does not update `.env.example`, unlike Phases 1 & 2).
  5. How candidate profile data is provided (Open Question 1 in lines 50–51 was left completely unresolved).  
  *Recommendation*: Explicitly document the LLM client import (e.g. `@google/genai`), target model, JSON schema validation pattern, resolve Open Question 1 by specifying candidate profile input fields in `NodeDefinition`, and add the required API key to `.env.example` in Phase 4.

---

### 3. TypeScript Manifest Contract Violations in `node-registry.ts` and `node-executors.ts` - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 259–262 (Phase 3) and Lines 269–272 (Phase 4)
* **Discrepancy Description**: The plan specifies adding registry entries with `kind: "enrichExecutive"` and `kind: "synthesizePitch"` and property `category: "Integrations"`, while registering camelCase keys `enrichExecutive` and `synthesizePitch` in `node-executors.ts`.
* **Rationale & Recommendation**: In `features/workflows/nodes/node-registry.ts`:
  1. `StepNodeKind` is strictly `"trigger" | "action"` (`node-registry.ts` line 5). Assigning `kind: "enrichExecutive"` or `kind: "synthesizePitch"` will cause a TypeScript compilation error. The node type is set via `type: string`, and `kind` must be `"action"`.
  2. `NodeDefinition` does not have a `category` property.
  3. In `features/workflows/nodes/node-executors.ts`, the mapping satisfies `Record<ActionNodeType, NodeExecutor>`. Navix standardizes on kebab-case for multi-word action nodes (`"open-url"`, `"send-email"`). In Phase 5 (lines 281, 283), the plan itself references kebab-case `"enrich-executive"` and `"synthesize-pitch"`. Mismatched camelCase keys in `node-executors.ts` will fail type checking against `ActionNodeType`.  
  *Recommendation*: Update Phase 3 and Phase 4 to specify `type: "enrich-executive"` / `type: "synthesize-pitch"`, `kind: "action"`, conform strictly to `NodeDefinition` without extraneous properties, and register matching kebab-case keys in `nodeExecutors`.

---

### 4. Incomplete `outbound-service.ts` Function Signatures and Missing Table/Credential Resolution - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 237–240 (Phase 1: `lib/airtable/outbound-service.ts`)
* **Discrepancy Description**: Phase 1 specifies two functions: `checkDomainExists(baseId: string, domain: string)` and `createOutboundPitch(baseId: string, fields: OutboundPitchFields)`, but omits auth credentials and table name parameters.
* **Rationale & Recommendation**: Both functions accept `baseId` but omit `tableName: string` and auth credentials (Personal Access Token). Phase 1 modifies `.env.example` to add `AIRTABLE_OUTBOUND_TABLE_NAME`, but neither function signature accepts it or specifies how environment variables are resolved. In existing `lib/airtable/client.ts`, `getAirtableConfig()` manages token and table resolution centrally. Furthermore, the plan does not define how default fields (`Status = 'Pending Review'`, `Staged Date = new Date().toISOString()`) are populated.  
  *Recommendation*: Define exact function signatures and configuration resolution:
  ```ts
  export interface OutboundAirtableConfig {
    personalAccessToken?: string
    baseId: string
    tableName: string
  }
  export function checkDomainExists(domain: string, config?: OutboundAirtableConfig): Promise<boolean>
  export function createOutboundPitch(fields: Omit<OutboundPitchFields, "Status" | "Staged Date"> & Partial<Pick<OutboundPitchFields, "Status" | "Staged Date">>, config?: OutboundAirtableConfig): Promise<string>
  ```

---

### 5. Missing Browser Navigation and Multi-Entity State Handling in Phase 5 DAG - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 278–284 (Phase 5: Workflow DAG template)
* **Discrepancy Description**: Phase 5 defines the DAG sequence: 1. `open-url` (Inc42), 2. `extract` (startups list), 3. `enrich-executive` (Apollo API), 4. `agent` (profiles startup landing page). In this sequence, the browser remains parked on the Inc42 article; no node navigates the browser to the startup landing pages before `agent` executes.
* **Rationale & Recommendation**: In Navix, the `agent` node operates on the active page of the shared Browserbase session; its inputs are `instruction`, `candidateProfile`, and `maxSteps` (no URL input). After `extract` runs on Inc42, the browser is still on Inc42. The plan does not include an `open-url` node for the startup website, nor can a static DAG step navigate to 10 dynamically extracted URLs.  
  *Recommendation*: Clarify how landing page profiling occurs: either execute profiling server-side via Cheerio/Playwright fetch within the enrichment worker, or document the exact sub-DAG / batch execution mechanism that navigates the browser per startup.

---

### 6. Testing Strategy Dissonance with Existing Airtable Client Architecture - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 241–242 (Phase 1: `lib/airtable/__tests__/outbound-service.test.ts`)
* **Discrepancy Description**: Phase 1 states: "Provides unit tests mocking the Airtable SDK to verify deduplication queries...".
* **Rationale & Recommendation**: Navix's existing Airtable integration (`lib/airtable/client.ts`, `service.ts`, and `features/workflows/nodes/__tests__/airtable.test.ts`) does not call methods from the `airtable` npm package. It implements a custom, rate-limited REST client (`airtableFetch`) and tests it using a `createMockFetch` test helper. Instructing an implementer to "mock the Airtable SDK" introduces conflicting architectural patterns and confuses test setup.  
  *Recommendation*: Align the test specification with `features/workflows/nodes/__tests__/airtable.test.ts`: test `outbound-service.ts` using mocked HTTP fetch calls (`createMockFetch`) simulating Airtable REST endpoints (`filterByFormula` query and `POST` record creation).

---

### 7. Unspecified Workflow Template Storage, Schema, and Ingestion Mechanism - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 277–284 (Phase 5: `features/workflows/templates/funded-startup-outreach.json`)
* **Discrepancy Description**: Phase 5 creates `features/workflows/templates/funded-startup-outreach.json`, but does not define its JSON schema, loader mechanism, or how it is seeded into Navix's database. Additionally, the DAG list omits the mandatory `start` trigger node.
* **Rationale & Recommendation**: Navix stores workflow graphs in PostgreSQL (`workflows` table in `lib/db/schema.ts`) matching `{ nodes: StepNodeType[]; edges: Edge[] }` validated by `validateGraph` (`features/workflows/lib/validate-graph.ts`). `validateGraph` strictly enforces: `Graph must have exactly one trigger node, but has 0`. Furthermore, there is no `features/workflows/templates/` folder in the repository today.  
  *Recommendation*: Include the mandatory `start` trigger node in the template definition, provide the exact JSON structure adhering to `WorkflowGraph`, and document how the template is seeded into the database (e.g. via Drizzle seed script or workflow template loader).

---

### 8. Missing Error Handling and Unresolved Open Questions for Enrichment Fallbacks - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 250, 258–264 (Phases 2 & 3)
* **Discrepancy Description**: The plan specifies that the Apollo client returns `provider: 'none'` when no verified email is found, but does not specify how `enrich-executive.ts` or downstream nodes handle this state.
* **Rationale & Recommendation**: Open Question 2 (lines 52–53) asked: "For startups where Apollo returns no verified corporate email, should the workflow mark the record as Missing Contact... or halt downstream processing...?" The implementation plan leaves this completely unanswered. If `enrich-executive` returns empty fields, does downstream `synthesize-pitch` fail or still run? Does the Airtable step stage a `Missing Contact` record?  
  *Recommendation*: Resolve Open Question 2 directly in Phase 3 & 4 specifications: when `provider === 'none'`, downstream pitch synthesis should be bypassed, and the record should be staged into Airtable with `Status = 'Missing Contact'` and executive LinkedIn URL if available.

---

### 9. Omission of `package.json` Script and Test Runner Config for Integration Testing - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 285–286 (Phase 5: `scripts/test-outreach-pipeline.ts`)
* **Discrepancy Description**: Phase 5 introduces `scripts/test-outreach-pipeline.ts`, but omits `package.json` from the modified files list and does not specify the npm script command or runtime execution flags.
* **Rationale & Recommendation**: Standalone scripts in Navix rely on `npx tsx` and `dotenv_config_path=.env.local` (e.g. `package.json` line 18: `"bot:dev"`). Without adding an npm script or documenting exact execution instructions, the implementer must invent execution scripts.  
  *Recommendation*: Add `package.json` to Phase 5 modified files and add an npm script entry: `"test:outreach": "npx tsx -r dotenv/config scripts/test-outreach-pipeline.ts dotenv_config_path=.env.local"`.

---

### 10. Subjective / Fluff Justification in Section Introduction - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 232
* **Discrepancy Description**: "The implementation is executed in five discrete, independently testable phases to ensure clean git commit history and avoid monolithic pull requests."
* **Rationale & Recommendation**: Defensive editorializing about git commit cleanliness adds unnecessary fluff to an implementation task list.  
  *Recommendation*: Simplify to: "The implementation is divided into five phases:" (Action: `DROP`).

---

### 11. Redundant Nested Bullet Prefix Pattern (`*Rationale*:`) - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 236, 238, 242, 244, 248, 250, 252, 254, 258, 260, 262, 264, 268, 270, 272, 274, 278, 286
* **Discrepancy Description**: The `* *Rationale*: ` prefix is repeated 18 times across all file entries.
* **Rationale & Recommendation**: Repetitive meta-labels add structural clutter. Implementation tasks should directly state the technical specifications.  
  *Recommendation*: Remove the `*Rationale*:` prefix and state the implementation instructions directly beneath each file item (Action: `DROP`).

---

### 12. Colloquial / Uncalibrated Constraints in Synthesis Node Specification - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 268
* **Discrepancy Description**: "peer-to-peer tone, zero ungrounded flattery".
* **Rationale & Recommendation**: Phrases like "zero ungrounded flattery" are colloquial rather than measurable prompt engineering constraints.  
  *Recommendation*: Replace with concrete negative prompting constraints (e.g. "forbid flattering adjectives such as 'revolutionary', 'impressive', or 'innovative'") (Action: `CALIBRATE`).
