---
name: profile-comparator
status: backlog
created: 2026-04-23T00:58:06Z
updated: 2026-04-23T01:55:28Z
github_issue: 14
progress: 35%
prd: .claude/prds/profile-comparator.md
subagents_used: none (direct authoring — 3hr hackathon optimization)
context_optimization: true
sprint_type: hackathon-3hr
team_size: 3 (Dev 1, Dev 2, UX Designer)
---

# Epic: Salesforce Profile Permission Comparator — 3hr Hackathon MVP

## 🎯 Overview

Deliver a conversational S1 feature that accepts a natural-language prompt ("Compare profile X between OrgA and OrgB"), scrapes both orgs via the Salesforce Tooling API, computes permission differences, and returns a downloadable XLS diff report. Built as a Next.js app on Vercel using the Vercel AI SDK for chat orchestration. The epic is decomposed into **4 work streams** chosen so three developers can build in parallel for the first ~1h40m and converge for a 30-minute integration window.

## 🏗️ Architecture Decisions

### Repository Layout (contract between streams)
```
profile-comparator/
├── app/
│   ├── api/
│   │   ├── chat/route.ts               # Stream D — AI SDK endpoint
│   │   ├── salesforce/
│   │   │   ├── profiles/route.ts       # Stream A — profile lookup + fuzzy
│   │   │   ├── objects/route.ts        # Stream A — object list for picker
│   │   │   └── scrape/route.ts         # Stream A — permission scrape (all 4 types)
│   │   └── export/route.ts             # Stream B — XLS generation + download
│   ├── components/
│   │   ├── chat/                       # Stream C — chat shell
│   │   ├── selectors/                  # Stream C — option + object selectors
│   │   └── ui/                         # Stream C — primitives
│   ├── page.tsx                        # Stream C
│   └── layout.tsx                      # Stream C
├── lib/
│   ├── salesforce/
│   │   ├── client.ts                   # Stream A — REST/Tooling wrapper
│   │   ├── queries.ts                  # Stream A — SOQL builders
│   │   ├── profiles.ts                 # Stream A — profile ops
│   │   ├── scrape.ts                   # Stream A — 4 scrape functions
│   │   └── types.ts                    # Stream A — SHARED TYPES (see note)
│   ├── diff/
│   │   └── engine.ts                   # Stream B — diff computation
│   ├── xlsx/
│   │   └── generator.ts                # Stream B — SheetJS export
│   └── ai/
│       ├── tools.ts                    # Stream D — AI SDK tool defs
│       └── parser.ts                   # Stream D — prompt parser
└── types/
    └── shared.ts                       # Cross-stream shared types (owned by D, agreed at 0:20)
```

**Critical contract:** `lib/salesforce/types.ts` is the shape contract between Stream A (producer) and Stream B (consumer). It must be stubbed and committed by Stream A at **0:30** so Stream B can write against real types.

### Data Flow
```
[User prompt]
    ↓
Stream D: parse + chat route                 (app/api/chat/route.ts)
    ↓ (AI SDK tool call)
Stream A: /api/salesforce/profiles           (fuzzy validate)
    ↓
Stream C: option selector card renders       (components/selectors/)
    ↓ (user picks type; if Object Settings → object picker)
Stream A: /api/salesforce/objects            (list objects)
    ↓
Stream A: /api/salesforce/scrape             (parallel Promise.all both orgs)
    ↓
Stream B: lib/diff/engine.ts                 (compute deltas)
    ↓
Stream B: /api/export                        (generate XLS, return download URL)
    ↓
[Download link in chat]
```

### Tech Stack (from PRD — no re-derivation)
- Frontend: Next.js 14 App Router + TypeScript + React
- AI: Vercel AI SDK (streaming + tool calls)
- Auth: OAuth 2.0 session tokens (assumed already connected to S1)
- Salesforce: REST + Tooling API (Metadata SOAP API explicitly excluded)
- Files: SheetJS (`xlsx`) for XLS output
- Hosting: Vercel (serverless functions + edge)

### Key Design Constraints
- **Parallel scraping** — both orgs queried via `Promise.all()`, never sequentially.
- **No raw API output to user** — always surface loading state, then structured result.
- **Object Settings picker virtualizes** if list > 50 items (react-window or AI SDK equivalent).
- **XLS = differences only** — empty diff → chat message, no file.

## 🔄 Work Streams

### Stream A · Salesforce Integration Layer
**Parallel:** Yes (starts 0:20, runs independently through 1:10)
**Owner:** Dev 2
**Agent type:** backend-architect
**Files owned:** `lib/salesforce/**`, `app/api/salesforce/**`
**Dependencies:** None (can start immediately after scaffolding)
**Blocks:** B (needs types by 0:30), D (needs endpoints by 1:00)

Tasks:
| ID | Task | Size | ETA |
|---|---|---|---|
| A1 | SF client + OAuth session helper (`lib/salesforce/client.ts`). Reads session tokens for both orgs, exposes `query(soql, org)`. | S | 0:20 → 0:40 |
| A2 | Profile lookup + fuzzy match (`lib/salesforce/profiles.ts` + `/api/salesforce/profiles`). Queries both Name and Label, returns up to 5 suggestions under 2s. Implements F-01/AC-02. | S | 0:40 → 1:00 |
| A3 | 4 scrape functions (`lib/salesforce/scrape.ts` + `/api/salesforce/scrape`) — ObjectPermissions, PermissionSet (IsOwnedByProfile), SetupEntityAccess+TabSet, SetupEntityAccess+ApexClass. Runs both orgs in parallel. Implements F-02. | M | 0:20 → 1:10 (parallel with A1/A2) |
| A4 | Object list endpoint (`/api/salesforce/objects`) for the picker. Returns `{apiName, label}[]`. | XS | 1:00 → 1:10 |

Shared contract deliverable (commit by 0:30):
```ts
// lib/salesforce/types.ts
export type OrgId = 'A' | 'B';
export type PermissionCategory = 'object_settings' | 'system_permissions' | 'app_permissions' | 'apex_class_access';
export interface PermissionRow {
  key: string;              // e.g. "Account" or "ModifyAllData" or "MyApexClass"
  category: PermissionCategory;
  values: Record<string, boolean | string>;  // e.g. {PermissionsCreate: true, PermissionsRead: true}
}
export interface ScrapeResult {
  org: OrgId;
  category: PermissionCategory;
  rows: PermissionRow[];
}
```

---

### Stream B · Diff Engine + XLS Export
**Parallel:** Partially — starts 1:10 after Stream A types finalized (can stub-start at 0:30 against the type contract)
**Owner:** Dev 2 (hands off from A) — or Dev 1 if A runs long
**Agent type:** fullstack-developer
**Files owned:** `lib/diff/**`, `lib/xlsx/**`, `app/api/export/**`
**Dependencies:** A1 merged (types), A3 returning real data for integration test
**Blocks:** D4 (final glue)

Tasks:
| ID | Task | Size | ETA |
|---|---|---|---|
| B1 | Diff engine (`lib/diff/engine.ts`) — takes two `ScrapeResult[]` arrays, emits `DiffRow[]` with types: `missing_in_a`, `missing_in_b`, `value_mismatch`. Pure function, unit-testable. Implements F-04 core logic. | S | 1:10 → 1:40 |
| B2 | SheetJS generator (`lib/xlsx/generator.ts` + `/api/export`) — single sheet, 5 columns per PRD, yellow fill for mismatch / red for missing. Filename format: `profile-comparison_{ProfileName}_{OrgA}_vs_{OrgB}_{YYYY-MM-DD}.xlsx`. Returns `Response` with proper content-type. Implements F-04 output. | S | 1:40 → 2:10 |

---

### Stream C · Chat UI + Inline Components
**Parallel:** Yes (starts 0:20, runs independently through 1:10)
**Owner:** UX Designer
**Agent type:** frontend-developer
**Files owned:** `app/page.tsx`, `app/layout.tsx`, `app/components/**`
**Dependencies:** None (mocks chat responses locally until Stream D wires up)
**Blocks:** D4 (needs components to render in tool results)

Tasks:
| ID | Task | Size | ETA |
|---|---|---|---|
| C1 | Chat shell (`app/page.tsx` + `components/chat/`) using Vercel AI SDK `useChat()` hook. Basic message list + composer. Style per S1 conventions. | S | 0:20 → 0:50 |
| C2 | 4-option selector card (`components/selectors/ComparisonTypeSelector.tsx`). Distinct tappable cards for Object Settings / System / App / Apex. Only one selection per session. Implements F-02/AC-03. | S | 0:50 → 1:10 |
| C3 | Object picker (`components/selectors/ObjectPicker.tsx`) — searchable checkbox list, "Select All", client-side filter per-keystroke, "Run Comparison" CTA disabled until ≥1 selected. Virtualize if >50 items. Implements F-03/AC-04. | M | 0:20 → 1:10 (parallel with C1/C2) |

**Stream C mocking strategy:** C can call `fetch('/api/salesforce/profiles')` etc. from day one — Stream A just needs to land endpoints by 1:10. If A is late, C stubs fetch responses with fixture JSON matching `lib/salesforce/types.ts`.

---

### Stream D · AI Orchestration + Integration
**Parallel:** Starts 0:20 (prompt parser + chat route skeleton), major integration at 2:10
**Owner:** Dev 1
**Agent type:** backend-architect
**Files owned:** `app/api/chat/route.ts`, `lib/ai/**`, `types/shared.ts`
**Dependencies:** A2 for profile validation tool, A3 for scrape tool, B1+B2 for export tool, C2+C3 for UI components in tool responses
**Blocks:** Nothing downstream — this is the terminal stream

Tasks:
| ID | Task | Size | ETA |
|---|---|---|---|
| D1 | Prompt parser (`lib/ai/parser.ts`) — extracts `{profileName, orgA, orgB}` from free-form text. If only 1 org found → clarifying-question branch. Implements AC-01. | S | 0:20 → 0:50 |
| D2 | AI SDK tool definitions (`lib/ai/tools.ts`) — `validateProfile`, `listObjects`, `runComparison`. Each tool calls the corresponding Stream A endpoint. | S | 0:50 → 1:20 |
| D3 | Chat route (`app/api/chat/route.ts`) wiring `streamText` + tools. Handles fuzzy-suggestion response (F-01) and one-org-missing halt (AC-02). | S | 1:20 → 1:40 |
| D4 | End-to-end integration — tool results render Stream C components inline, wire `runComparison` → scrape → diff → export → return download URL in chat. Implements AC-05 (empty diff → message, no file). | M | 2:10 → 2:40 |

## 📊 Task Summary

| # | Task | Stream | Size | Agent | Depends On | Parallel? |
|---|---|---|---|---|---|---|
| 1 | A1 — SF client + OAuth helper | A | S | backend-architect | — | ✅ with C1/C3/D1 |
| 2 | A2 — Profile fuzzy lookup | A | S | backend-architect | A1 | — |
| 3 | A3 — 4 permission scrapers | A | M | backend-architect | A1 | ✅ with A2 |
| 4 | A4 — Object list endpoint | A | XS | backend-architect | A1 | ✅ with A2/A3 |
| 5 | B1 — Diff engine | B | S | fullstack-developer | A3 (types) | ✅ with B2-prep, D2 |
| 6 | B2 — XLS generator + export route | B | S | fullstack-developer | B1 | — |
| 7 | C1 — Chat shell | C | S | frontend-developer | — | ✅ with A*/D1 |
| 8 | C2 — 4-option selector card | C | S | frontend-developer | C1 | — |
| 9 | C3 — Object picker (searchable + virtualized) | C | M | frontend-developer | — | ✅ with C1/C2 |
| 10 | D1 — Prompt parser | D | S | backend-architect | — | ✅ with A*/C* |
| 11 | D2 — AI SDK tool definitions | D | S | backend-architect | A1 | ✅ with A2/A3 |
| 12 | D3 — Chat route w/ streaming + tools | D | S | backend-architect | D1, D2 | — |
| 13 | D4 — End-to-end integration | D | M | backend-architect | A3, B2, C2, C3, D3 | ❌ (convergence) |

**Total tasks:** 13
**Estimated effort:** ~3h wall-clock with 3 devs in parallel (aligns with PRD's 3hr sprint)
**Critical path:** A1 → A3 → B1 → B2 → D4 (≈ 2h 20m sequential)
**Max parallel capability:** 4 tasks simultaneously in the 0:20–1:10 window (A1+A2, A3, C1+C2, C3, D1, D2)
**Convergence point:** 2:10 — Stream D4 integration begins; all others must have landed.

## 🗺️ Dependency Graph

```
0:00 ─ Setup & scaffolding (all)
0:20 ─┬─ A1 ────┬─ A2 ──┐
      │         ├─ A3 ──┼─┐
      │         └─ A4 ──┘ │
      ├─ C1 ──── C2 ──────┤
      ├─ C3 ───────────────┤
      └─ D1 ──── D2 ──── D3 ┤
                            ├─ B1 ── B2 ┐
                            │            │
2:10 ─────────────────────── D4 ────────┘── Demo ready 2:40
```

## ✅ Acceptance Criteria (Technical)

Mapped directly from PRD's AC-01 through AC-05:

- [ ] **AC-01** Prompt with profile + 2 orgs correctly parsed; Org A is always reference; single-org prompt triggers clarifying question. *(D1, D3)*
- [ ] **AC-02** Fuzzy suggestions (up to 5) returned under 2s; profile missing from one org halts flow with which-org message. *(A2, D3)*
- [ ] **AC-03** 4 comparison types rendered as distinct tappable cards; only one selectable; flow gated until selection. *(C2, D3)*
- [ ] **AC-04** Object list renders within 3s of Object Settings selection; search filters per-keystroke client-side; "Run Comparison" disabled until ≥1 checked. *(A4, C3)*
- [ ] **AC-05** XLS contains only differing rows; 5 columns per spec; yellow/red conditional formatting; empty diff → chat message, no file. *(B1, B2, D4)*

Additional technical gates:
- [ ] Both orgs scraped via `Promise.all()` — verified in A3 code review.
- [ ] No raw Tooling API responses surfaced to chat — verified in D4 demo.
- [ ] Tooling API queries use `LIMIT/OFFSET` pagination — verified in A3.
- [ ] 10-second timeout on scrape with user-facing error — verified in A3.
- [ ] Metadata SOAP API not imported anywhere — `grep -r "Metadata" lib/` returns nothing.

## ⚠️ Risks & Mitigations

Inherited from PRD plus implementation-specific risks:

| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
| Tooling API governor limits / timeouts on large orgs | 🔴 High | A3: paginate with LIMIT/OFFSET; parallel orgs; 10s timeout + toast. | Dev 2 |
| OAuth token expiry mid-demo | 🔴 High | Pre-sprint token refresh test; D3 catches 401 and surfaces "Session expired. Reconnect Org X." | Dev 1 |
| `lib/salesforce/types.ts` contract drifts between A & B | 🟠 Medium | Types committed by 0:30 as hard contract; any change requires both A & B pair-review. | Dev 2 |
| Stream A endpoints late → Stream C + D blocked | 🟠 Medium | C mocks fetch with fixture JSON matching type contract; D2 tools can stub responses until A3 lands. | UX / Dev 1 |
| Vercel AI SDK tool-call loop timeout on long scrapes (>10s edge runtime) | 🟠 Medium | Use Node runtime (not edge) for `/api/chat`; background scrape via direct endpoint call, short-lived tool. | Dev 1 |
| Profile API name vs Label ambiguity | 🟠 Medium | A2 queries both Name and Label; fuzzy suggestions present both. | Dev 2 |
| SheetJS color formatting fails in older viewers | 🟠 Medium | Difference Type text column is authoritative; colors are enhancement. | Dev 2 |
| Merge conflicts between streams on shared `types/shared.ts` | 🟢 Low | D owns `types/shared.ts`; A owns `lib/salesforce/types.ts`. Clean separation. | — |

## 🔗 Dependencies

- **Internal:** None — greenfield project. No other epics, no shared modules yet.
- **External:**
  - Salesforce OAuth session tokens for both test orgs (assumed live in S1 at sprint start).
  - Vercel account + project (created in 0:00–0:20 setup block).
  - npm packages: `ai`, `@ai-sdk/openai` (or provider), `xlsx`, `next`, `react`, `react-window` (if virtualizing).
- **Blocking (pre-sprint):** Confirm Tooling API access on both test orgs. Owner: Dev 2 before 0:00.
- **Blocked by:** None.

## 📋 Next Steps

1. Review epic with team (5 min at sprint kickoff).
2. Generate per-task files: `/oden:tasks profile-comparator`
3. Optional — push to GitHub Issues for tracking: `/oden:sync profile-comparator`
4. Begin 3-hour sprint.
