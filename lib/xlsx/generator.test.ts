/**
 * lib/xlsx/generator.test.ts — unit tests for XLSX export (B2)
 *
 * Verifies the two critical contracts with the /api/export route:
 *   - empty DiffRow[] returns null (drives HTTP 204 / AC-05 branch)
 *   - non-empty input returns a Uint8Array that starts with the ZIP
 *     magic bytes (XLSX is a zip container)
 *
 * Bonus: parse the generated buffer with SheetJS's own read API to
 * verify the 5 expected column headers and that row content round-trips
 * correctly. Also exercises the buildFilename helper against the PRD
 * filename format.
 */

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildFilename, generateXlsx } from "./generator";
import type { DiffRow } from "@/lib/diff/engine";

const META = {
  profileName: "Admin",
  orgAName: "Production",
  orgBName: "Staging",
};

function mismatchRow(): DiffRow {
  return {
    id: "object_settings:Account",
    key: "Account",
    category: "object_settings",
    valueA: { Read: true, Edit: false },
    valueB: { Read: true, Edit: true },
    type: "value_mismatch",
  };
}

function missingInARow(): DiffRow {
  return {
    id: "system_permissions:ViewAllData",
    key: "ViewAllData",
    category: "system_permissions",
    valueA: null,
    valueB: { enabled: true },
    type: "missing_in_a",
  };
}

function missingInBRow(): DiffRow {
  return {
    id: "apex_class_access:MyApexClass",
    key: "MyApexClass",
    category: "apex_class_access",
    valueA: { enabled: true },
    valueB: null,
    type: "missing_in_b",
  };
}

describe("generateXlsx — empty input", () => {
  it("returns null for an empty DiffRow array (drives 204 branch)", () => {
    expect(generateXlsx([], META)).toBeNull();
  });
});

describe("generateXlsx — non-empty input", () => {
  it("returns a non-empty Uint8Array", () => {
    const buf = generateXlsx([mismatchRow()], META);
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf!.length).toBeGreaterThan(0);
  });

  it("buffer starts with the XLSX/ZIP magic bytes (PK\\x03\\x04)", () => {
    const buf = generateXlsx([mismatchRow()], META);
    expect(buf).not.toBeNull();
    const b = buf!;
    // ZIP local file header signature: 0x50 0x4B 0x03 0x04
    expect(b[0]).toBe(0x50); // P
    expect(b[1]).toBe(0x4b); // K
    expect(b[2]).toBe(0x03);
    expect(b[3]).toBe(0x04);
  });

  it("round-trips through SheetJS read with the 5 PRD column headers", () => {
    const rows = [mismatchRow(), missingInARow(), missingInBRow()];
    const buf = generateXlsx(rows, META);
    expect(buf).not.toBeNull();

    const wb = XLSX.read(buf!, { type: "array" });
    expect(wb.SheetNames).toContain("Differences");

    const ws = wb.Sheets["Differences"];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      defval: "",
    });

    // Header row
    expect(aoa[0]).toEqual([
      "Permission / Object",
      "Category",
      "Org A (Reference)",
      "Org B",
      "Difference Type",
    ]);

    // One data row per DiffRow
    expect(aoa.length).toBe(rows.length + 1);
  });

  it("maps diff types to their human-readable text labels", () => {
    const rows = [mismatchRow(), missingInARow(), missingInBRow()];
    const buf = generateXlsx(rows, META);
    const wb = XLSX.read(buf!, { type: "array" });
    const ws = wb.Sheets["Differences"];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      defval: "",
    });

    // Column E (index 4) is the Difference Type
    const diffTypes = aoa.slice(1).map((r) => r[4]);
    expect(diffTypes).toContain("Value mismatch");
    expect(diffTypes).toContain("Missing in Org A");
    expect(diffTypes).toContain("Missing in Org B");
  });

  it("renders missing-side values as an em-dash placeholder", () => {
    const buf = generateXlsx([missingInARow()], META);
    const wb = XLSX.read(buf!, { type: "array" });
    const ws = wb.Sheets["Differences"];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      defval: "",
    });
    // Row 1 (data row 0), column C (index 2) is Org A value — should be —
    expect(aoa[1][2]).toBe("—");
  });
});

describe("buildFilename", () => {
  it("produces the PRD-specified format with ISO date", () => {
    const today = new Date("2026-04-22T12:34:56Z");
    const name = buildFilename(META, today);
    expect(name).toBe(
      "profile-comparison_Admin_Production_vs_Staging_2026-04-22.xlsx",
    );
  });

  it("sanitises whitespace and slashes in profile/org names", () => {
    const name = buildFilename(
      {
        profileName: "Standard User",
        orgAName: "Org/A",
        orgBName: "Org B",
      },
      new Date("2026-01-15T00:00:00Z"),
    );
    // Non-alphanumeric runs collapse to a single dash.
    expect(name).toMatch(
      /^profile-comparison_Standard-User_Org-A_vs_Org-B_2026-01-15\.xlsx$/,
    );
  });

  it("falls back to 'unknown' when a name is purely non-alphanumeric", () => {
    const name = buildFilename(
      { profileName: "///", orgAName: "A", orgBName: "B" },
      new Date("2026-04-22T00:00:00Z"),
    );
    expect(name).toContain("unknown");
  });

  it("defaults to today's date when no date is passed", () => {
    const name = buildFilename(META);
    // YYYY-MM-DD segment must be a valid ISO date chunk
    expect(name).toMatch(/_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
