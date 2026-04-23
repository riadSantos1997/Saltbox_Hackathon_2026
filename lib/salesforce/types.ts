/**
 * lib/salesforce/types.ts — CROSS-STREAM CONTRACT FILE (A1)
 *
 * This module defines the shape contract between Stream A (producer of
 * ScrapeResult) and Stream B (consumer in the diff engine and XLSX
 * generator). Any change to these types requires a pair review with
 * Stream B owners because it can break the diff engine silently.
 *
 * DO NOT leak raw Salesforce Tooling API JSON through these types —
 * scrapers must map API records into PermissionRow[] before returning.
 */

/** Identifier for the two orgs being compared. Org A is always the baseline. */
export type OrgId = "A" | "B";

/** The four permission categories supported by the MVP (PRD F-02). */
export type PermissionCategory =
  | "object_settings"
  | "system_permissions"
  | "app_permissions"
  | "apex_class_access";

/**
 * A single permission row in an org. The `key` uniquely identifies the
 * permission within its category — object API name for ObjectPermissions,
 * the flag name for System Permissions, TabSet name for App Permissions,
 * ApexClass name for Apex Class Access.
 *
 * `values` is a flat record of the boolean / string attributes that make
 * up the permission. The diff engine uses deep-equality on this record to
 * detect value mismatches.
 */
export interface PermissionRow {
  /** e.g. "Account" | "ModifyAllData" | "MyApexClass" */
  key: string;
  /** Category this row belongs to — mirrors the ScrapeResult.category. */
  category: PermissionCategory;
  /** Flat map of attribute name → boolean | string. */
  values: Record<string, boolean | string>;
}

/** The output of a single scrape against a single org for a single category. */
export interface ScrapeResult {
  org: OrgId;
  category: PermissionCategory;
  rows: PermissionRow[];
}

/**
 * Thrown when Salesforce returns 401/403 on a query. Stream D renders a
 * "Session expired. Please reconnect Org X." message when this surfaces.
 */
export class SessionExpiredError extends Error {
  readonly org: OrgId;
  constructor(org: OrgId) {
    super(`Salesforce session expired for Org ${org}`);
    this.name = "SessionExpiredError";
    this.org = org;
  }
}

/**
 * Session credentials for a single org. In production these are read from
 * whatever store S1 uses for connected org tokens. For the MVP we read
 * them from environment variables (see `lib/salesforce/session.ts`).
 */
export interface OrgSession {
  org: OrgId;
  accessToken: string;
  /** Org instance host without protocol, e.g. "mycompany.my.salesforce.com" */
  domain: string;
  /** Salesforce API version, e.g. "v60.0". Always includes the leading "v". */
  apiVersion: string;
}

/** Which Salesforce REST surface a query targets. */
export type QueryEndpoint = "tooling" | "data";

export interface QueryOptions {
  /**
   * Endpoint to route the SOQL through. Defaults to "tooling" (legacy
   * behavior). Use "data" for standard sObjects that the Tooling API
   * does not expose — notably `SetupEntityAccess`.
   */
  endpoint?: QueryEndpoint;
}

/** Subset of the `describe` response we consume — field names + types. */
export interface DescribeResult {
  fields: { name: string; type: string }[];
}

/** A minimal Salesforce query client exposed by `getClient(org)`. */
export interface SalesforceClient {
  org: OrgId;
  /** Issue a SOQL query. Defaults to the Tooling API endpoint. */
  query<T = unknown>(soql: string, opts?: QueryOptions): Promise<T>;
  /**
   * Describe a standard sObject via the REST Data API. Used to discover
   * which `Permissions*` fields actually exist on this org's edition so
   * we don't INVALID_FIELD on edition-specific permission columns.
   */
  describe(sobject: string): Promise<DescribeResult>;
}

/**
 * The JSON shape Salesforce returns for a Tooling API query. We keep it
 * here (rather than in scrape.ts) so scrapers can type their raw
 * responses without adding a dependency on any SF SDK package.
 */
export interface ToolingQueryResponse<R> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: R[];
}
