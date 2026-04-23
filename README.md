# Saltbox Hackathon 2026 — Profile Permission Comparator

An S1-powered chat feature that compares Salesforce profile permissions between two orgs via a natural-language prompt and delivers a downloadable XLS diff report.

> **3-hour sprint · Saltbox · S1 + Salesforce**

---

## The problem

Deployment teams at Saltbox manually compare profile permissions between Salesforce orgs screen-by-screen in Setup. It's error-prone, slow, and leaves no artifact. This feature replaces that workflow with:

```
"Compare the Sales Rep profile between OrgA and OrgB"
        ↓
[ 4 comparison-type cards ] → [ Object picker if Object Settings ]
        ↓
parallel Tooling API scrape (both orgs)
        ↓
diff engine
        ↓
profile-comparison_SalesRep_OrgA_vs_OrgB_2026-04-23.xlsx
```

Only rows that differ — by value or by absence — land in the file. Yellow for value mismatches, red for missing. Empty diff returns a chat message, not an empty file.

## Scope (MVP)

**In:** Profile fuzzy lookup · 4 comparison types (Object Settings, System Permissions, App Permissions, Apex Class Access) · Org A/B comparison · Chat-native UI · XLS export.

**Out of MVP:** Field-Level Security · Permission Sets · N-org comparison (>2) · Confluence auto-gen · Scheduled comparisons.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend / Chat UI | Next.js 14 · TypeScript · React |
| AI orchestration | Vercel AI SDK (streaming + tool calls) |
| Salesforce auth | OAuth 2.0 session tokens (inherited from S1) |
| Metadata fetch | Salesforce REST + Tooling API |
| Diff / file gen | SheetJS (`xlsx`) |
| Hosting | Vercel (Node runtime for `/api/chat`) |

Metadata SOAP API is **explicitly excluded** from the MVP to reduce surface area.

## Planning artifacts

This project was scoped using a Documentation-First methodology. Everything was planned before any implementation code was written.

| Artifact | Location |
|---|---|
| **PRD** (v1.0 MVP, 226 lines) | [`.claude/prds/profile-comparator.md`](.claude/prds/profile-comparator.md) |
| **Epic** (4 work streams, 13 tasks) | [`.claude/epics/profile-comparator/epic.md`](.claude/epics/profile-comparator/epic.md) |
| **Per-task files** | [`.claude/epics/profile-comparator/`](.claude/epics/profile-comparator/) (A1.md … D4.md) |
| **Tracking issue** | [#14 — Epic: Salesforce Profile Permission Comparator](../../issues/14) |

## Work streams

Four streams designed for parallel execution by a 3-person team (2 devs + UX designer):

| Stream | Owner | Scope | Files |
|---|---|---|---|
| **A** — Salesforce Integration | Dev 2 | OAuth client, profile lookup, permission scrapers, object list | `lib/salesforce/**`, `app/api/salesforce/**` |
| **B** — Diff + XLS Export | Dev 2 (handoff) | Pure diff engine + SheetJS generator | `lib/diff/**`, `lib/xlsx/**`, `app/api/export/**` |
| **C** — Chat UI | UX Designer | Chat shell, option selector card, object picker | `app/page.tsx`, `app/components/**` |
| **D** — AI Orchestration | Dev 1 | Prompt parser, AI SDK tools, chat route, integration | `app/api/chat/**`, `lib/ai/**` |

### Dependency graph

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

**Critical path:** A1 → A3 → B1 → B2 → D4 (≈ 2h 20m). **Convergence:** 2:10. **Demo prep:** 2:50–3:00.

## Repo layout

```
.
├── .claude/                             # Planning + AI tooling
│   ├── prds/
│   │   └── profile-comparator.md        # Product requirements
│   ├── epics/
│   │   └── profile-comparator/
│   │       ├── epic.md                  # Technical epic
│   │       └── {A1..D4}.md              # 13 task files
│   ├── agents/
│   │   └── test-engineer.md             # Test engineer sub-agent
│   └── skills/
│       └── salesforce-development/      # SFDC patterns skill
│           └── SKILL.md
└── README.md                            # You are here
```

## Running the 3-hour sprint

1. **Pre-sprint (before 0:00):** Confirm Salesforce OAuth session tokens are live for both test orgs. Verify Tooling API access.
2. **Track progress:** Check off tasks on [issue #14](../../issues/14) as they land.
3. **File boundaries are hard:** Each stream owns disjoint paths — agents should not collide. The contract file `lib/salesforce/types.ts` **must** be committed by Stream A at 0:30 (Stream B and D both depend on it).
4. **At convergence (2:10):** All streams merged to main. D4 wires everything end-to-end.
5. **Demo at 3:00.**

## Acceptance criteria (from PRD)

- **AC-01** Prompt parsing — profile + 2 orgs extracted from free-form text
- **AC-02** Fuzzy profile match under 2s; one-org-missing halts flow
- **AC-03** 4 comparison types as distinct tappable cards
- **AC-04** Object picker renders in 3s; search filters per-keystroke client-side
- **AC-05** XLS contains only differing rows; empty diff → chat message, no file

## License / attribution

Internal Saltbox hackathon project. Planning methodology: Oden (Documentation-First).
