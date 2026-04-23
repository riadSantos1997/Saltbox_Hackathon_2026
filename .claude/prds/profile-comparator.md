---
name: profile-comparator
description: S1 chat feature that compares Salesforce profile permissions between two orgs via natural language prompt and exports an XLS diff report
status: backlog
created: 2026-04-23T00:55:15Z
updated: 2026-04-23T00:55:15Z
version: 1.0-MVP
source: authored-by-user
brainstorming_skipped: true
origin: Saltbox · S1 Hackathon · 3-Hour Sprint
---

# PRD: Salesforce Profile Permission Comparator

## 📊 Executive Summary

The Profile Permission Comparator is a conversational feature built on top of S1's existing chat interface. It allows deployment team members to compare Salesforce profile permissions between two orgs using a natural language prompt. S1 scrapes the relevant metadata from both orgs via the Salesforce Tooling API, computes the differences, and delivers a downloadable XLS report showing only the rows that differ — either by value or by absence.

**Tags:** Hackathon MVP · 3-Hour Sprint · S1 + Salesforce

## 🎯 Problem Statement

Deployment teams at Saltbox regularly need to validate that a profile's permissions in a source org are correctly mirrored in a target org. Today this is manual: engineers navigate Salesforce Setup, compare screens side by side, and document differences by hand. Error-prone, slow, and invisible to stakeholders.

### Current State → Desired State

| Current State | Desired State |
|---|---|
| Manual screen-by-screen comparison in Salesforce Setup | Single prompt → structured diff report in seconds |
| No systematic record of permission gaps between orgs | Downloadable XLS file as deployment artifact |
| High risk of human error during validation | Automated, deterministic comparison via Tooling API |
| Blocked on Salesforce knowledge to navigate Setup | Accessible via natural language through S1 chat |

## 📋 Scope

### ✅ In Scope (MVP)
- Profile name validation with fuzzy fallback
- Org A vs. Org B comparison (extensible to N orgs)
- Object Settings comparison with search + checkbox UI
- System Permissions comparison
- App Permissions comparison
- Apex Class Access comparison
- XLS export — differences only (absences + value mismatches)
- Chat UI built following S1 design conventions

### ❌ Out of Scope (MVP)
- Multi-option comparison in a single session
- Confluence page auto-generation
- Org connection / authentication setup
- Write operations to either org
- Field-level Security comparison
- Permission Set comparison
- Comparison of more than 2 orgs simultaneously
- Scheduled / automated comparisons

### 🧩 Assumptions
- Both orgs are already connected to S1
- The user is authenticated and logged in
- S1 inherits the user's read/write permissions on both orgs
- The Tooling API is available on both orgs
- Org A is always the reference (baseline) org
- One comparison type per session

## 🧭 User Flow

1. **Create a new chat in S1** — User opens S1 and starts a fresh conversation. *(User)*
2. **Enter a natural language prompt** — User types the profile name and both org names. Example: *"Compare the Sales Rep profile between OrgA and OrgB."* S1 parses profile name, Org A (reference), and Org B. If profile not found, S1 responds with fuzzy-matched suggestions. *(User)*
3. **Select a comparison type** — S1 presents four options as interactive cards: Object Settings, System Permissions, App Permissions, Apex Class Access. *(S1)*
4. **Object Settings → Choose objects (conditional)** — If Object Settings selected, S1 renders a searchable checkbox list of objects. User filters, selects, and confirms with "Run Comparison". Search filters in real time; "Run Comparison" is the action-oriented CTA. *(User + S1)*
5. **Background: Scrape Org A and Org B** — S1 queries both orgs via Tooling API for the selected comparison type. User sees loading/thinking state; no raw API output exposed. *(Background)*
6. **Background: Compute differences** — S1 compares results. A difference = (a) a permission in one org but not the other, or (b) same permission with different values. *(Background)*
7. **Deliver the XLS report** — S1 returns a download link. File contains only differing rows, formatted as a structured table. *(S1)*

## ⚙️ Feature Specifications

### F-01 · Profile Validation
When the user submits a prompt, S1 must validate that the named profile exists in **both orgs** before proceeding.
- Match is case-insensitive.
- If not found, S1 queries both orgs for profile names and returns up to 5 fuzzy-matched suggestions.
- User selects one of the suggestions or cancels.
- If found in one org but not the other, S1 reports which org is missing the profile and halts.

### F-02 · Comparison Type Selector

| Option | Tooling API Object | What is Compared |
|---|---|---|
| Object Settings | `ObjectPermissions` | CRUD + ViewAll + ModifyAll per object |
| System Permissions | `PermissionSet` (IsOwnedByProfile) | Boolean system-level flags (e.g., ModifyAllData) |
| App Permissions | `SetupEntityAccess` + `TabSet` | Visible / default apps per profile |
| Apex Class Access | `SetupEntityAccess` + `ApexClass` | Apex classes marked as Enabled |

### F-03 · Object Selector UI (Object Settings only)
- Renders inside the chat as an inline component — not a modal or new page.
- Search input at the top filters the object list in real time (client-side).
- Checkbox list with object API names (and labels where available).
- "Select All" shortcut available.
- Confirm CTA reads "Run Comparison" — disabled until at least one object is selected.
- If the object list exceeds 50 items, virtualize to prevent DOM overload.

### F-04 · XLS Output Format

Single-sheet XLS with the following columns:

| Column | Description |
|---|---|
| Permission / Object | API name of the permission or object being compared |
| Category | Object Settings / System Permission / App Permission / Apex Class |
| Org A (Reference) | Value in the reference org |
| Org B | Value in the target org |
| Difference Type | "Missing in Org A" / "Missing in Org B" / "Value mismatch" |

**Rules:**
- Only rows with differences are included. Matching permissions are excluded.
- Filename: `profile-comparison_{ProfileName}_{OrgA}_vs_{OrgB}_{YYYY-MM-DD}.xlsx`
- Value mismatch rows are highlighted in yellow.
- "Missing" rows are highlighted in red.

## 🏗️ Technical Architecture

### Stack

| Layer | Technology | Role |
|---|---|---|
| Frontend / Chat UI | TypeScript + React | Chat interface, inline components |
| AI Orchestration | Vercel AI SDK | Streaming responses, tool calls, state |
| Salesforce Auth | OAuth 2.0 (JWT Bearer / Web Server) | Session tokens per org |
| Metadata Fetch | Salesforce REST API + Tooling API | Profile scraping |
| File Generation | SheetJS (xlsx library) | XLS file creation in-browser or server |
| Hosting | Vercel | Serverless functions + edge runtime |

### API Strategy — REST + Tooling API
- REST API handles authentication and org identity. Base URL: `https://{orgDomain}/services/data/vXX.0/`
- Tooling API endpoint: `/services/data/vXX.0/tooling/query/?q=`
- **Object Permissions:** `SELECT SobjectType, PermissionsCreate, PermissionsRead... FROM ObjectPermissions WHERE Parent.Profile.Name = '{ProfileName}'`
- **System Permissions:** `PermissionSet WHERE IsOwnedByProfile = true AND Profile.Name = '{ProfileName}'`
- **Apex access:** `SetupEntityAccess WHERE SetupEntity.Type = 'ApexClass' AND Parent.Profile.Name = '{ProfileName}'`
- All queries run in parallel per org using `Promise.all()` — not sequentially.
- Metadata API (SOAP) is explicitly **excluded** from the MVP to reduce complexity.

## 👥 User Stories

| ID | As a… | I want to… | So that… | Priority |
|---|---|---|---|---|
| US-01 | Deployment engineer | compare a named profile between two orgs via a chat prompt | I can quickly identify permission gaps without navigating Salesforce Setup | 🔴 Must |
| US-02 | Deployment engineer | receive fuzzy-matched suggestions when I mistype a profile name | I don't lose context and can continue without restarting | 🔴 Must |
| US-03 | Deployment engineer | select which category of permissions to compare | I can focus on what's relevant for the current deployment | 🔴 Must |
| US-04 | Deployment engineer | search and filter objects before running a comparison | I don't have to scroll through hundreds of objects manually | 🔴 Must |
| US-05 | Deployment engineer | download an XLS file with only the rows that differ | I have a deployment artifact that's easy to share and review | 🔴 Must |
| US-06 | Team lead | see which org is the reference baseline in the report | I can interpret directional differences clearly | 🟡 Should |
| US-07 | Deployment engineer | see a loading state while S1 scrapes the orgs | I know the process is running and haven't lost context | 🟡 Should |

## ✅ Acceptance Criteria

### AC-01 · Prompt parsing (US-01)
- Given a prompt containing a profile name and two org names, S1 correctly identifies all three and initiates the flow.
- Org A is always treated as the reference baseline.
- If only one org name is given, S1 asks a clarifying question before proceeding.

### AC-02 · Profile validation (US-02)
- If the profile name doesn't match exactly, S1 returns up to 5 suggestions from both orgs within 2 seconds.
- If the profile exists in only one org, S1 reports which org it's missing from and does not proceed.

### AC-03 · Option selector (US-03)
- All four comparison types are presented as distinct, tappable options.
- Only one option can be selected per session.
- S1 does not proceed until the user makes a selection.

### AC-04 · Object selector (US-04)
- The object list renders inside the chat within 3 seconds of option selection.
- Search input filters results on each keystroke without a server roundtrip.
- The "Run Comparison" button is disabled until at least one checkbox is selected.

### AC-05 · XLS output (US-05)
- The file contains only rows where permissions differ (by value or by absence).
- The file includes columns: Permission/Object, Category, Org A, Org B, Difference Type.
- Value mismatches are highlighted in yellow; missing permissions in red.
- If no differences are found, S1 responds with a message and does not generate a file.

## 📈 Success Criteria

- **Primary:** A deployment engineer can go from prompt to downloaded XLS diff in under 30 seconds for a profile with <100 objects.
- **Accuracy:** XLS output matches a manual side-by-side Setup comparison 100% for the four compared categories.
- **Demo-readiness:** End-to-end flow works against two real orgs during the 3-hour sprint demo.

## 📅 Hackathon Timeline (3 hours)

| Block | Time | Owner | Deliverable |
|---|---|---|---|
| Setup & scaffolding | 0:00 – 0:20 | Both devs | Repo, Vercel project, Tooling API auth confirmed on both orgs |
| Profile validation + prompt parsing | 0:20 – 0:50 | Dev 1 | Working profile lookup + fuzzy suggestion response |
| Tooling API scraping — all 4 types | 0:20 – 1:10 | Dev 2 | Data fetch functions for ObjectPermissions, SystemPerms, AppPerms, ApexClass |
| Chat UI — option selector + object picker | 0:20 – 1:10 | UX Designer | Inline React components: 4-option selector, searchable checkbox list |
| Diff engine | 1:10 – 1:40 | Dev 1 | Function that computes absences + value mismatches between org datasets |
| XLS generation + download link | 1:40 – 2:10 | Dev 2 | SheetJS output with formatting (colors, headers) |
| Integration + end-to-end test | 2:10 – 2:40 | QA + All | Full flow from prompt to XLS download — with real orgs |
| Bug fixes + polish | 2:40 – 2:50 | All | Loading states, error states, edge cases |
| Demo prep | 2:50 – 3:00 | All | Slide or live demo script |

## ⚠️ Risks & Mitigations

| Level | Risk | Mitigation |
|---|---|---|
| 🔴 High | Tooling API query limits or timeouts on large orgs | Paginate queries with LIMIT/OFFSET. Run both orgs in parallel. Add a 10-second timeout with a user-facing error message. |
| 🔴 High | OAuth token expiry or permission scope gaps during the hackathon | Test token refresh flow before the sprint. Add a visible error state: "Session expired. Please reconnect Org X." |
| 🟠 Medium | Profile API name vs. label ambiguity in prompt | Query both Name and Label fields in the Profile object. Present both in fuzzy-match suggestions. |
| 🟠 Medium | XLS color formatting not rendering in all viewers | Use a "Difference Type" text column as the primary indicator. Colors are an enhancement, not the only signal. |
| 🟢 Low | Object list is empty in one org but populated in the other | S1 should detect this and inform the user before running the comparison. |

## 💡 Nice to Have (Post-MVP)

| Feature | Effort | Value |
|---|---|---|
| Confluence page auto-generation with comparison results | Medium | High — creates a persistent deployment artifact |
| Multi-option comparison in a single session | Low | Medium — reduces round trips for thorough audits |
| N-org comparison (more than 2) | High | Medium — useful for sandbox → staging → prod flows |
| Field-Level Security comparison per object | Medium | High — FLS gaps are a common deployment issue |
| Permission Set comparison (not just profiles) | Medium | High — many orgs use permission sets over profiles now |
| Scheduled / automated comparisons via S1 | High | High — proactive regression detection |
| Inline diff preview inside the chat (before download) | Low | Medium — faster feedback loop |

## 📋 Next Steps

1. Review PRD with stakeholders for completeness.
2. Convert to technical epic: `/oden:epic profile-comparator`
3. Decompose epic into tasks: `/oden:tasks profile-comparator`
4. Begin implementation (3-hour sprint).
