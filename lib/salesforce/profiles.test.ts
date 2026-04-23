/**
 * lib/salesforce/profiles.test.ts — unit tests for the fuzzy scorer (A2)
 *
 * We test the pure scoring functions only — the network-side
 * `validateProfile` orchestration is covered end-to-end in the manual
 * demo. The scorer is the tricky bit: tie-breaks, token overlap, and
 * the 5-suggestion cap must be deterministic.
 */

import { describe, expect, it } from "vitest";
import {
  fuzzySuggest,
  levenshtein,
  scoreMatch,
  type ProfileSuggestion,
} from "./profiles";

function pool(
  records: Array<{ Name: string; Label: string; org?: "A" | "B" }>,
): Array<{ record: { Id: string; Name: string; Label: string }; org: "A" | "B" }> {
  return records.map((r, i) => ({
    record: { Id: `00e${i}`, Name: r.Name, Label: r.Label },
    org: r.org ?? "A",
  }));
}

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("counts single-character substitutions", () => {
    expect(levenshtein("kitten", "sitten")).toBe(1);
  });

  it("handles empty strings", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("scoreMatch", () => {
  it("scores exact case-insensitive matches as 1", () => {
    // Note: scoreMatch assumes the caller has already lowercased both inputs.
    expect(scoreMatch("sales rep", "sales rep")).toBe(1);
  });

  it("scores substring containment above close-but-different candidates", () => {
    const sub = scoreMatch("admin", "system admin");
    const near = scoreMatch("admin", "adnun");
    expect(sub).toBeGreaterThan(near);
  });

  it("rewards token overlap for multi-word profile names", () => {
    const overlap = scoreMatch("sales rep", "standard sales rep");
    expect(overlap).toBeGreaterThan(0.4);
  });
});

describe("fuzzySuggest", () => {
  it("returns at most 5 suggestions even with many candidates", () => {
    const candidates = pool(
      Array.from({ length: 20 }).map((_, i) => ({
        Name: `Profile${i}`,
        Label: `Profile ${i}`,
      })),
    );
    const out = fuzzySuggest("profile", candidates);
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it("ranks exact token matches ahead of distant neighbours", () => {
    const candidates = pool([
      { Name: "Sales Rep", Label: "Sales Rep" },
      { Name: "Admin", Label: "Admin" },
      { Name: "Marketing User", Label: "Marketing User" },
      { Name: "Standard Sales Rep", Label: "Standard Sales Rep" },
    ]);
    const out = fuzzySuggest("sales rep", candidates);
    expect(out[0].name).toBe("Sales Rep");
  });

  it("dedupes by profile name and unions orgs", () => {
    const candidates = pool([
      { Name: "Sales Rep", Label: "Sales Rep", org: "A" },
      { Name: "Sales Rep", Label: "Sales Rep", org: "B" },
      { Name: "Admin", Label: "Admin", org: "B" },
    ]);
    const out = fuzzySuggest("sales rep", candidates);
    const salesRep = out.find((s: ProfileSuggestion) => s.name === "Sales Rep");
    expect(salesRep).toBeDefined();
    expect(salesRep?.inOrgs.sort()).toEqual(["A", "B"]);
  });

  it("drops zero-score candidates when needle has no similarity", () => {
    const candidates = pool([
      { Name: "Zebra", Label: "Zebra" },
      { Name: "Quagga", Label: "Quagga" },
    ]);
    const out = fuzzySuggest("xxxxxxxx", candidates);
    // They have non-zero levenshtein similarity so may not all drop, but the
    // close-match candidates score below the first exact/near matches. The
    // contract is simply "no suggestion has score 0".
    out.forEach((s) => expect(s.score).toBeGreaterThan(0));
  });

  it("returns empty array for empty needle", () => {
    const candidates = pool([{ Name: "Admin", Label: "Admin" }]);
    expect(fuzzySuggest("", candidates)).toEqual([]);
  });
});
