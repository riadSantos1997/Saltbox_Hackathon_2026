/**
 * lib/diff/engine.test.ts — unit tests for the diff engine (B1)
 *
 * Covers each acceptance criterion:
 *   - missing_in_a (permission only in Org B)
 *   - missing_in_b (permission only in Org A)
 *   - value_mismatch (same key, different attribute values)
 *   - identical inputs → empty array (drives AC-05 "no differences" branch)
 *   - multi-category input preserved with correct categorization
 */

import { describe, expect, it } from "vitest";
import { diff, type DiffRow } from "./engine";
import type { ScrapeResult } from "@/lib/salesforce/types";

function objectSettings(
  org: "A" | "B",
  rows: Array<{
    key: string;
    values: Record<string, boolean | string>;
  }>,
): ScrapeResult {
  return {
    org,
    category: "object_settings",
    rows: rows.map((r) => ({ ...r, category: "object_settings" as const })),
  };
}

function systemPerms(
  org: "A" | "B",
  rows: Array<{
    key: string;
    values: Record<string, boolean | string>;
  }>,
): ScrapeResult {
  return {
    org,
    category: "system_permissions",
    rows: rows.map((r) => ({ ...r, category: "system_permissions" as const })),
  };
}

describe("diff engine", () => {
  it("returns an empty array when both orgs are identical", () => {
    const rows = [
      {
        key: "Account",
        values: { PermissionsRead: true, PermissionsCreate: false },
      },
    ];
    const result = diff(
      [objectSettings("A", rows)],
      [objectSettings("B", rows)],
    );
    expect(result).toEqual([]);
  });

  it("returns an empty array when both inputs are empty", () => {
    expect(diff([], [])).toEqual([]);
  });

  it("emits missing_in_b when a permission exists only in Org A", () => {
    const a = objectSettings("A", [
      { key: "Account", values: { PermissionsRead: true } },
    ]);
    const b = objectSettings("B", []);
    const result = diff([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject<Partial<DiffRow>>({
      key: "Account",
      category: "object_settings",
      type: "missing_in_b",
      valueA: { PermissionsRead: true },
      valueB: null,
    });
  });

  it("emits missing_in_a when a permission exists only in Org B", () => {
    const a = objectSettings("A", []);
    const b = objectSettings("B", [
      { key: "Contact", values: { PermissionsRead: true } },
    ]);
    const result = diff([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject<Partial<DiffRow>>({
      key: "Contact",
      category: "object_settings",
      type: "missing_in_a",
      valueA: null,
      valueB: { PermissionsRead: true },
    });
  });

  it("emits value_mismatch when same key has different values", () => {
    const a = objectSettings("A", [
      {
        key: "Opportunity",
        values: { PermissionsRead: true, PermissionsEdit: false },
      },
    ]);
    const b = objectSettings("B", [
      {
        key: "Opportunity",
        values: { PermissionsRead: true, PermissionsEdit: true },
      },
    ]);
    const result = diff([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject<Partial<DiffRow>>({
      key: "Opportunity",
      category: "object_settings",
      type: "value_mismatch",
    });
    expect(result[0].valueA).toEqual({
      PermissionsRead: true,
      PermissionsEdit: false,
    });
    expect(result[0].valueB).toEqual({
      PermissionsRead: true,
      PermissionsEdit: true,
    });
  });

  it("handles multi-category input and keeps categories separate", () => {
    // Same key ("ModifyAllData") across two categories should NOT
    // collide — the composite id includes the category.
    const a = [
      objectSettings("A", [
        { key: "Account", values: { PermissionsRead: true } },
      ]),
      systemPerms("A", [{ key: "ModifyAllData", values: { Enabled: true } }]),
    ];
    const b = [
      objectSettings("B", [
        { key: "Account", values: { PermissionsRead: false } }, // value_mismatch
      ]),
      systemPerms("B", [
        { key: "ModifyAllData", values: { Enabled: true } }, // identical, dropped
        { key: "ViewSetup", values: { Enabled: true } }, // missing_in_a
      ]),
    ];

    const result = diff(a, b);
    expect(result).toHaveLength(2);

    const byId = new Map(result.map((r) => [r.id, r]));
    expect(byId.get("object_settings:Account")?.type).toBe("value_mismatch");
    expect(byId.get("system_permissions:ViewSetup")?.type).toBe("missing_in_a");
  });

  it("detects value_mismatch when one side has extra attribute keys", () => {
    const a = objectSettings("A", [
      { key: "Lead", values: { PermissionsRead: true } },
    ]);
    const b = objectSettings("B", [
      {
        key: "Lead",
        values: { PermissionsRead: true, PermissionsCreate: true },
      },
    ]);
    const result = diff([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("value_mismatch");
  });

  it("returns rows sorted by id for deterministic output", () => {
    const a = objectSettings("A", [
      { key: "Zeta", values: { PermissionsRead: true } },
      { key: "Alpha", values: { PermissionsRead: true } },
    ]);
    const b = objectSettings("B", []);
    const result = diff([a], [b]);
    expect(result.map((r) => r.key)).toEqual(["Alpha", "Zeta"]);
  });

  it("merges duplicate scrapes of the same category (later wins)", () => {
    // If a caller scrapes two disjoint object subsets and concatenates
    // them, diff() should union — not double-count.
    const a = [
      objectSettings("A", [
        { key: "Account", values: { PermissionsRead: true } },
      ]),
      objectSettings("A", [
        { key: "Contact", values: { PermissionsRead: true } },
      ]),
    ];
    const b = [
      objectSettings("B", [
        { key: "Account", values: { PermissionsRead: true } },
        { key: "Contact", values: { PermissionsRead: true } },
      ]),
    ];
    expect(diff(a, b)).toEqual([]);
  });
});
