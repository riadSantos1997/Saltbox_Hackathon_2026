/**
 * lib/ai/parser.ts — natural-language prompt parser (D1)
 *
 * Pure function. Given free-form text like
 *   "Compare the Sales Rep profile between OrgA and OrgB"
 * extract `{ profileName, orgA, orgB }`. If only one org is named,
 * return `{ needsClarification: 'missing_second_org' }` so D3 can halt
 * and ask the user.
 *
 * Rule-based. No LLM call — this is deterministic prompt routing, not
 * reasoning. The LLM-driven tool loop takes over after this.
 *
 * Implements AC-01:
 *  - Both orgs present → parsed result; first-mentioned org is Org A.
 *  - Single org → clarification branch.
 *  - Profile casing preserved (downstream A2 is case-insensitive).
 */

/** Successful parse — both orgs + profile extracted. */
export interface ParsedPrompt {
  profileName: string;
  /** Reference org (first-mentioned in the prompt). */
  orgA: string;
  /** Comparison org. */
  orgB: string;
}

export interface NeedsClarification {
  needsClarification: "missing_second_org";
  /** What we did manage to extract — useful for the follow-up prompt. */
  profileName?: string;
  orgA?: string;
}

export type ParseResult = ParsedPrompt | NeedsClarification;

/**
 * Parse a user prompt into structured comparison parameters. See module
 * header for the contract. Non-matching inputs return a clarification
 * signal rather than throwing.
 */
export function parsePrompt(text: string): ParseResult {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return { needsClarification: "missing_second_org" };
  }

  const profileName = extractProfile(trimmed);
  const orgs = extractOrgs(trimmed);

  if (orgs.length >= 2) {
    return {
      profileName: profileName ?? "",
      orgA: orgs[0],
      orgB: orgs[1],
    };
  }

  return {
    needsClarification: "missing_second_org",
    profileName: profileName ?? undefined,
    orgA: orgs[0],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Extractors — exported for unit tests.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract the profile name. Tries a few patterns, in order of specificity:
 *   1. quoted: "Sales Rep" or 'Sales Rep'
 *   2. "the X profile" / "profile X"
 *   3. "compare X between" (capture between the verb and "between")
 */
export function extractProfile(text: string): string | null {
  // 1. Quoted string wins.
  const quoted = text.match(/["'“”‘’]([^"'“”‘’]+)["'“”‘’]/);
  if (quoted) return quoted[1].trim();

  // 2. "the Sales Rep profile" / "Sales Rep profile"
  const theXProfile = text.match(/(?:the\s+)([\w][\w\s-]*?)\s+profile\b/i);
  if (theXProfile) return cleanProfile(theXProfile[1]);

  // 3. "profile Sales Rep" / "profile: Sales Rep"
  const profileX = text.match(/\bprofile[:\s]+([\w][\w\s-]*?)(?=\s+(?:between|for|in|across|from|against|and)\b|$)/i);
  if (profileX) return cleanProfile(profileX[1]);

  // 4. "compare X between ... and ..."
  const compareBetween = text.match(/compare\s+([\w][\w\s-]*?)\s+(?:between|in|across|for|on)\b/i);
  if (compareBetween) return cleanProfile(compareBetween[1]);

  return null;
}

/**
 * Extract org names in the order they appear. Looks for tokens that
 * either follow "between/and/in/from/to/vs" or match an explicit
 * Org-style pattern (OrgA, "Prod Org", etc.). Deduped, preserving
 * first-seen ordering so orgA = the first mentioned.
 */
export function extractOrgs(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const name = raw.trim().replace(/[,.]$/, "");
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(name);
  };

  // Pattern 1: explicit "between X and Y" / "X and Y" / "X vs Y" / "X to Y"
  const betweenAnd = text.match(
    /(?:between|from)\s+([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,2})\s+(?:and|vs\.?|to|with)\s+([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,2})/i,
  );
  if (betweenAnd) {
    push(betweenAnd[1]);
    push(betweenAnd[2]);
  }

  // Pattern 2: Org-style tokens (OrgA, Org A, "my-org-1", Sandbox1)
  const orgTokenRe = /\b((?:Org\s?[A-Z0-9][\w-]*|Sandbox[0-9A-Za-z-]*|Production|Staging|Prod|Dev))\b/gi;
  let m;
  while ((m = orgTokenRe.exec(text)) !== null) {
    push(m[1]);
  }

  // Pattern 3: "in X and Y"
  if (found.length < 2) {
    const inAnd = text.match(
      /\bin\s+([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,2})\s+and\s+([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,2})/i,
    );
    if (inAnd) {
      push(inAnd[1]);
      push(inAnd[2]);
    }
  }

  return found;
}

function cleanProfile(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
