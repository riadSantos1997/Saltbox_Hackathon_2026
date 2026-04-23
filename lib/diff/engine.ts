/**
 * lib/diff/engine.ts — permission diff engine (B1)
 *
 * Pure function. No IO, no timing, no randomness. Given two arrays of
 * ScrapeResult (one per org), emit DiffRow[] containing only the
 * permissions that differ — either by absence in one org or by value
 * mismatch.
 *
 * Matching permissions are excluded: the PRD specifies the XLS report
 * contains only differences. An empty return array is the signal D4
 * uses to show "no differences found" and skip file generation (AC-05).
 */

import type {
  PermissionCategory,
  PermissionRow,
  ScrapeResult,
} from "@/lib/salesforce/types";

/** The type of difference surfaced in a DiffRow. */
export type DiffType = "missing_in_a" | "missing_in_b" | "value_mismatch";

/**
 * A single row in the diff report. `valueA` / `valueB` are the flat
 * attribute records from PermissionRow.values, or null when the
 * permission is absent in that org.
 */
export interface DiffRow {
  /** Composite key "category:permissionKey" — stable within a diff run. */
  id: string;
  /** The permission/object identifier (mirrors PermissionRow.key). */
  key: string;
  /** The category this difference belongs to. */
  category: PermissionCategory;
  /** Attribute record in Org A, or null if the permission is missing there. */
  valueA: Record<string, boolean | string> | null;
  /** Attribute record in Org B, or null if the permission is missing there. */
  valueB: Record<string, boolean | string> | null;
  /** Kind of difference — drives XLS row color and text label. */
  type: DiffType;
}

/**
 * Compute the differences between two sets of scrape results. `a` is
 * treated as the reference org ("Org A" per PRD). Matching permissions
 * are omitted.
 *
 * The same category may appear multiple times in either input (e.g. if
 * the caller ran separate scrapes for subsets of objects) — rows are
 * merged by (category, key) so later entries overwrite earlier ones.
 */
export function diff(a: ScrapeResult[], b: ScrapeResult[]): DiffRow[] {
  const aByKey = indexScrapeResults(a);
  const bByKey = indexScrapeResults(b);

  const allKeys = new Set<string>([...aByKey.keys(), ...bByKey.keys()]);
  const rows: DiffRow[] = [];

  for (const id of allKeys) {
    const aRow = aByKey.get(id);
    const bRow = bByKey.get(id);

    if (aRow && !bRow) {
      rows.push({
        id,
        key: aRow.key,
        category: aRow.category,
        valueA: aRow.values,
        valueB: null,
        type: "missing_in_b",
      });
      continue;
    }
    if (!aRow && bRow) {
      rows.push({
        id,
        key: bRow.key,
        category: bRow.category,
        valueA: null,
        valueB: bRow.values,
        type: "missing_in_a",
      });
      continue;
    }
    // Both present — compare values. Deep equality on the flat record.
    if (aRow && bRow && !shallowRecordEqual(aRow.values, bRow.values)) {
      rows.push({
        id,
        key: aRow.key,
        category: aRow.category,
        valueA: aRow.values,
        valueB: bRow.values,
        type: "value_mismatch",
      });
    }
    // Identical rows are dropped — XLS contains differences only.
  }

  // Stable ordering so output is deterministic for snapshot-style tests
  // and for users scanning the XLS.
  rows.sort((x, y) => x.id.localeCompare(y.id));
  return rows;
}

function indexScrapeResults(results: ScrapeResult[]): Map<string, PermissionRow> {
  const map = new Map<string, PermissionRow>();
  for (const result of results) {
    for (const row of result.rows) {
      // Use result.category rather than row.category to keep the index
      // consistent even if a producer forgets to set row.category (the
      // ScrapeResult.category is the authoritative value).
      const id = `${result.category}:${row.key}`;
      map.set(id, { ...row, category: result.category });
    }
  }
  return map;
}

/**
 * Shallow-equal on two flat records of primitives. Same keys, same
 * values (strict ===). Returns false if either record has a key the
 * other lacks.
 */
function shallowRecordEqual(
  a: Record<string, boolean | string>,
  b: Record<string, boolean | string>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}
