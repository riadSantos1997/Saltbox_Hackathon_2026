/**
 * lib/ai/parser.test.ts — unit tests for the prompt parser (D1)
 *
 * Covers AC-01 behaviours:
 *   - both orgs in the prompt → full ParsedPrompt
 *   - single org → clarification branch
 *   - profile casing preserved
 *   - whitespace-only input → clarification
 */

import { describe, expect, it } from "vitest";
import { parsePrompt } from "./parser";

describe("parsePrompt", () => {
  it("extracts profile + both orgs from the canonical prompt", () => {
    const out = parsePrompt(
      "Compare the Sales Rep profile between OrgA and OrgB",
    );
    expect(out).toEqual({
      profileName: "Sales Rep",
      orgA: "OrgA",
      orgB: "OrgB",
    });
  });

  it("returns clarification when only one org is mentioned", () => {
    const out = parsePrompt("Compare the Sales Rep profile in Production");
    expect("needsClarification" in out).toBe(true);
    if ("needsClarification" in out) {
      expect(out.needsClarification).toBe("missing_second_org");
      expect(out.profileName).toBe("Sales Rep");
      expect(out.orgA).toBe("Production");
    }
  });

  it("preserves the original casing of the profile name", () => {
    const out = parsePrompt(
      'Compare "Custom Sales Manager" profile between Prod and Sandbox1',
    );
    if ("needsClarification" in out) throw new Error("expected parsed result");
    expect(out.profileName).toBe("Custom Sales Manager");
  });

  it("handles leading/trailing whitespace without flinching", () => {
    const out = parsePrompt(
      "   Compare the Admin profile between Production and Staging   ",
    );
    if ("needsClarification" in out) throw new Error("expected parsed result");
    expect(out.profileName).toBe("Admin");
    expect(out.orgA).toBe("Production");
    expect(out.orgB).toBe("Staging");
  });

  it("flags empty input as needing clarification", () => {
    const out = parsePrompt("   ");
    expect("needsClarification" in out).toBe(true);
  });

  it("treats the first-mentioned org as Org A (reference)", () => {
    const out = parsePrompt(
      "Compare Marketing User profile between Sandbox1 and Production",
    );
    if ("needsClarification" in out) throw new Error("expected parsed result");
    expect(out.orgA).toBe("Sandbox1");
    expect(out.orgB).toBe("Production");
  });
});
