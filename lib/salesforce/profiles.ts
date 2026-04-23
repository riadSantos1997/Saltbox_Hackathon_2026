/**
 * lib/salesforce/profiles.ts — profile lookup + fuzzy match (A2)
 *
 * Pure(-ish) module for resolving a user-supplied profile name against
 * the two orgs. Queries each org's Profile entity for Name AND Label,
 * runs a case-insensitive exact match first, and falls back to fuzzy
 * scoring to surface up to 5 suggestions from the union of both orgs.
 *
 * The scoring function is intentionally simple — a length-normalized
 * Levenshtein distance, boosted by substring containment and token
 * overlap. Good enough for the demo, easy to unit-test.
 *
 * See `lib/salesforce/profiles.test.ts` for the contract we hold this
 * module to (fuzzy ordering, tie-break behaviour, suggestion count cap).
 */

import { getClient } from "./client";
import type { OrgId, ToolingQueryResponse } from "./types";

export interface ProfileRecord {
  Id: string;
  Name: string;
  Label: string;
}

/** Shape returned by a single-org lookup. Used internally; callers see `ProfileValidation`. */
interface SingleOrgMatch {
  org: OrgId;
  /** The profile as it exists in this org, if an exact (case-insensitive) match was found. */
  exact: ProfileRecord | null;
  /** Full list of profiles in this org, used as the candidate pool for fuzzy suggestions. */
  all: ProfileRecord[];
}

/** The union result of `validateProfile`. Consumed by D2/D3. */
export type ProfileValidation =
  | {
      found: true;
      profile: ProfileRecord;
      /** Which org's copy we're returning — always Org A when both match. */
      fromOrg: OrgId;
    }
  | {
      found: false;
      /** Set when the profile exists in exactly one of the two orgs. */
      missingIn: OrgId;
      existsIn: OrgId;
      profile: ProfileRecord;
    }
  | {
      found: false;
      /** Up to 5 fuzzy matches from the union of both orgs. */
      suggestions: ProfileSuggestion[];
    };

export interface ProfileSuggestion {
  name: string;
  label: string;
  /** Which org(s) this suggestion appears in. */
  inOrgs: OrgId[];
  /** Score in [0, 1], 1 = exact match. Higher is better. */
  score: number;
}

/**
 * Validate the profile against both orgs in parallel and return a
 * structured verdict. Never throws on a non-match — only throws if the
 * underlying Salesforce client fails (e.g., SessionExpiredError).
 */
export async function validateProfile(
  profileName: string,
  orgs: readonly OrgId[] = ["A", "B"],
): Promise<ProfileValidation> {
  if (orgs.length !== 2) {
    throw new Error(
      "validateProfile: expected exactly two orgs (the reference + target)",
    );
  }

  const [first, second] = await Promise.all(
    orgs.map((org) => lookupInOrg(org, profileName)),
  );

  if (first.exact && second.exact) {
    // Both orgs have it — return Org A's record as the canonical profile.
    return { found: true, profile: first.exact, fromOrg: first.org };
  }

  if (first.exact && !second.exact) {
    return {
      found: false,
      missingIn: second.org,
      existsIn: first.org,
      profile: first.exact,
    };
  }
  if (!first.exact && second.exact) {
    return {
      found: false,
      missingIn: first.org,
      existsIn: second.org,
      profile: second.exact,
    };
  }

  // Neither org has an exact match — compute fuzzy suggestions from the
  // union of both pools.
  const suggestions = fuzzySuggest(profileName, [
    ...first.all.map((p) => ({ record: p, org: first.org })),
    ...second.all.map((p) => ({ record: p, org: second.org })),
  ]);
  return { found: false, suggestions };
}

async function lookupInOrg(
  org: OrgId,
  profileName: string,
): Promise<SingleOrgMatch> {
  const client = getClient(org);
  const res = await client.query<ToolingQueryResponse<ProfileRecord>>(
    "SELECT Id, Name, Label FROM Profile",
  );
  const all = res.records ?? [];
  const needle = profileName.trim().toLowerCase();
  const exact =
    all.find(
      (p) =>
        (p.Name ?? "").toLowerCase() === needle ||
        (p.Label ?? "").toLowerCase() === needle,
    ) ?? null;
  return { org, exact, all };
}

// ─────────────────────────────────────────────────────────────────────────
// Fuzzy scoring — exported for unit tests.
// ─────────────────────────────────────────────────────────────────────────

interface ScoredCandidate {
  record: ProfileRecord;
  org: OrgId;
}

/**
 * Rank the candidate pool against the needle and return up to 5
 * suggestions from the union, de-duplicated by profile Name. When the
 * same profile name exists in both orgs, the suggestion's `inOrgs`
 * lists both.
 */
export function fuzzySuggest(
  needle: string,
  pool: readonly ScoredCandidate[],
  limit = 5,
): ProfileSuggestion[] {
  const n = needle.trim().toLowerCase();
  if (!n || pool.length === 0) return [];

  // Score every candidate against both Name and Label, keep the stronger
  // signal, then dedupe by Name while unioning the source orgs.
  type Scored = {
    name: string;
    label: string;
    org: OrgId;
    score: number;
  };
  const scored: Scored[] = pool.map(({ record, org }) => {
    const nameScore = scoreMatch(n, (record.Name ?? "").toLowerCase());
    const labelScore = scoreMatch(n, (record.Label ?? "").toLowerCase());
    return {
      name: record.Name,
      label: record.Label,
      org,
      score: Math.max(nameScore, labelScore),
    };
  });

  // Dedupe by name, union orgs, keep max score.
  const byName = new Map<string, ProfileSuggestion>();
  for (const s of scored) {
    const existing = byName.get(s.name);
    if (!existing) {
      byName.set(s.name, {
        name: s.name,
        label: s.label,
        inOrgs: [s.org],
        score: s.score,
      });
    } else {
      if (!existing.inOrgs.includes(s.org)) existing.inOrgs.push(s.org);
      if (s.score > existing.score) existing.score = s.score;
    }
  }

  return [...byName.values()]
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable tie-break: alphabetical by name.
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

/**
 * Return a score in [0, 1] for how closely `candidate` matches `needle`.
 * Combines three signals:
 *   1. Exact (case-insensitive) → 1
 *   2. Substring containment → bumped by length ratio
 *   3. Normalized Levenshtein distance
 *   4. Token overlap (handles "Sales Rep" vs "Standard Sales Rep")
 */
export function scoreMatch(needle: string, candidate: string): number {
  if (!needle || !candidate) return 0;
  if (needle === candidate) return 1;

  const lev = 1 - levenshtein(needle, candidate) / Math.max(needle.length, candidate.length);
  const substring =
    candidate.includes(needle) || needle.includes(candidate)
      ? 0.6 + 0.4 * (Math.min(needle.length, candidate.length) / Math.max(needle.length, candidate.length))
      : 0;
  const tokens = tokenOverlap(needle, candidate);

  return Math.max(lev, substring, tokens);
}

function tokenOverlap(a: string, b: string): number {
  const at = new Set(a.split(/\s+/).filter(Boolean));
  const bt = new Set(b.split(/\s+/).filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let hits = 0;
  for (const t of at) if (bt.has(t)) hits++;
  return hits / Math.max(at.size, bt.size);
}

/** Classic iterative Levenshtein — O(n·m) time, O(min(n,m)) space. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Keep the shorter string as the column axis for memory efficiency.
  if (a.length > b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  let prev = new Array(a.length + 1);
  let curr = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,       // insertion
        prev[i] + 1,           // deletion
        prev[i - 1] + cost,    // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}
