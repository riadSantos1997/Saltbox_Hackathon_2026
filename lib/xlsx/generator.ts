/**
 * lib/xlsx/generator.ts — XLSX export for diff rows (B2)
 *
 * Given a DiffRow[] and some metadata, emit a single-sheet XLSX with
 * the 5 columns specified in PRD F-04 / AC-05:
 *
 *   Permission / Object | Category | Org A (Reference) | Org B | Difference Type
 *
 * Styling note
 * ─────────────
 * The open-source `xlsx` (SheetJS Community Edition) package does NOT
 * write cell-level fills or fonts — styling is a SheetJS Pro feature.
 * We still attach `s` style metadata to each cell so that a consumer
 * using a Pro-style-aware renderer (or swapping in `xlsx-js-style`) will
 * see yellow for value_mismatch and red for missing rows. When opened
 * with vanilla SheetJS output the colors are dropped, but the
 * "Difference Type" text column remains authoritative per PRD (see the
 * Medium-severity risk mitigation in the PRD risks table).
 *
 * The header row is rendered bold in the Difference Type text cell
 * phrasing ("Missing in Org A" / "Missing in Org B" / "Value mismatch")
 * which is the primary, colour-independent signal.
 */

import * as XLSX from "xlsx";
import type { DiffRow } from "@/lib/diff/engine";
import type { PermissionCategory } from "@/lib/salesforce/types";

export interface XlsxMeta {
  profileName: string;
  /** Human-readable name for Org A (e.g. "Production"). */
  orgAName: string;
  /** Human-readable name for Org B (e.g. "Staging"). */
  orgBName: string;
}

const HEADERS = [
  "Permission / Object",
  "Category",
  "Org A (Reference)",
  "Org B",
  "Difference Type",
] as const;

const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  object_settings: "Object Settings",
  system_permissions: "System Permission",
  app_permissions: "App Permission",
  apex_class_access: "Apex Class",
};

const DIFF_TYPE_LABEL = {
  missing_in_a: "Missing in Org A",
  missing_in_b: "Missing in Org B",
  value_mismatch: "Value mismatch",
} as const;

// Fill colours (ARGB). Consumed by style-aware XLSX readers; ignored
// by SheetJS Community Edition on write.
const COLOR_YELLOW = "FFFFFF00";
const COLOR_RED = "FFFF0000";

/**
 * Build the XLSX workbook as a Uint8Array so API routes can stream it
 * in a `Response` body. Returns null when there are no differences so
 * callers can short-circuit to a 204 / "no differences" message per
 * AC-05.
 */
export function generateXlsx(
  rows: DiffRow[],
  meta: XlsxMeta,
): Uint8Array | null {
  if (rows.length === 0) return null;

  const aoa: (string | number | null)[][] = [HEADERS.slice()];
  for (const row of rows) {
    aoa.push([
      row.key,
      CATEGORY_LABELS[row.category],
      formatValue(row.valueA),
      formatValue(row.valueB),
      DIFF_TYPE_LABEL[row.type],
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  applyColumnWidths(ws);
  applyRowStyles(ws, rows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Differences");

  // Attach workbook props so reader tools can link the file back to the
  // comparison context without re-parsing the filename.
  wb.Props = {
    Title: `Profile Permission Comparison — ${meta.profileName}`,
    Subject: `${meta.orgAName} (reference) vs ${meta.orgBName}`,
    Author: "Saltbox S1",
  };

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Uint8Array(buf as ArrayBuffer);
}

/**
 * Build the download filename per PRD:
 *   profile-comparison_{ProfileName}_{OrgA}_vs_{OrgB}_{YYYY-MM-DD}.xlsx
 * Slashes and whitespace in the profile/org names are replaced to keep
 * the filename safe across browsers and OSes.
 */
export function buildFilename(meta: XlsxMeta, today: Date = new Date()): string {
  const date = today.toISOString().slice(0, 10); // YYYY-MM-DD
  return `profile-comparison_${safe(meta.profileName)}_${safe(meta.orgAName)}_vs_${safe(meta.orgBName)}_${date}.xlsx`;
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function formatValue(v: Record<string, boolean | string> | null): string {
  if (v === null) return "—";
  // Compact, human-readable: "Read=true, Edit=false".
  return Object.entries(v)
    .map(([k, val]) => `${k}=${typeof val === "boolean" ? (val ? "true" : "false") : val}`)
    .join(", ");
}

function applyColumnWidths(ws: XLSX.WorkSheet): void {
  // Rough widths to keep the sheet readable on first open.
  (ws as XLSX.WorkSheet & { "!cols"?: Array<{ wch: number }> })["!cols"] = [
    { wch: 32 }, // Permission / Object
    { wch: 20 }, // Category
    { wch: 40 }, // Org A value
    { wch: 40 }, // Org B value
    { wch: 18 }, // Difference Type
  ];
}

/**
 * Attach style metadata to data rows. SheetJS Community Edition does
 * not persist styles on write, but a consumer using xlsx-js-style or
 * SheetJS Pro will see the intended colours. The text column remains
 * the authoritative signal in every reader.
 */
function applyRowStyles(ws: XLSX.WorkSheet, rows: DiffRow[]): void {
  rows.forEach((row, i) => {
    const color = row.type === "value_mismatch" ? COLOR_YELLOW : COLOR_RED;
    const excelRow = i + 2; // +1 for 1-index, +1 for header row
    for (let col = 0; col < HEADERS.length; col++) {
      const addr = XLSX.utils.encode_cell({ r: excelRow - 1, c: col });
      const cell = (ws as XLSX.WorkSheet & Record<string, unknown>)[addr] as
        | (XLSX.CellObject & { s?: unknown })
        | undefined;
      if (!cell) continue;
      cell.s = {
        fill: { patternType: "solid", fgColor: { rgb: color } },
      };
    }
  });
}
