/**
 * lib/salesforce/scrape.ts — four permission-category scrapers (A3)
 *
 * Each category has a dedicated scraper that:
 *   1. Builds the SOQL via queries.ts
 *   2. Hits the Tooling API through client.ts
 *   3. Maps the raw JSON into PermissionRow[] — no raw API shape leaks
 *
 * The orchestrator `scrape()` runs the requested category against BOTH
 * orgs in parallel via Promise.all — per PRD/epic, this is non-negotiable.
 * A grep for sequential patterns in this file should come up empty.
 */

import { getClient } from "./client";
import {
  apexClassAccessQuery,
  apexClassLookupQuery,
  appPermissionsQuery,
  objectSettingsQuery,
  systemPermissionsQuery,
  SYSTEM_PERMISSION_FIELDS,
  tabSetLookupQuery,
} from "./queries";
import type {
  OrgId,
  PermissionCategory,
  PermissionRow,
  SalesforceClient,
  ScrapeResult,
  ToolingQueryResponse,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────
// Raw record shapes — internal, never exported. Mapped to PermissionRow.
// ─────────────────────────────────────────────────────────────────────────

interface ObjectPermissionRecord {
  SobjectType: string;
  PermissionsCreate: boolean;
  PermissionsRead: boolean;
  PermissionsEdit: boolean;
  PermissionsDelete: boolean;
  PermissionsViewAllRecords: boolean;
  PermissionsModifyAllRecords: boolean;
}

type SystemPermissionRecord = Record<string, boolean | string>;

interface SetupEntityAccessRecord {
  Id: string;
  SetupEntityId: string;
  SetupEntityType: string;
}

interface TabSetRecord {
  Id: string;
  Label: string;
  Namespace?: string | null;
  DurableId: string;
}

interface ApexClassRecord {
  Id: string;
  Name: string;
  NamespacePrefix?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export interface ScrapeOptions {
  category: PermissionCategory;
  profileName: string;
  orgs: readonly OrgId[];
  /** Optional filter for object_settings — subset of SobjectType values. */
  selectedObjects?: readonly string[];
}

/**
 * Scrape the requested permission category across the supplied orgs in
 * parallel. Returns one ScrapeResult per org.
 */
export async function scrape(opts: ScrapeOptions): Promise<ScrapeResult[]> {
  const { category, profileName, orgs, selectedObjects } = opts;
  if (orgs.length === 0) {
    throw new Error("scrape(): at least one org must be specified");
  }
  // CRITICAL: Promise.all — both orgs queried in parallel (PRD/epic).
  return Promise.all(
    orgs.map((org) =>
      scrapeOneOrg({ org, category, profileName, selectedObjects }),
    ),
  );
}

async function scrapeOneOrg(args: {
  org: OrgId;
  category: PermissionCategory;
  profileName: string;
  selectedObjects?: readonly string[];
}): Promise<ScrapeResult> {
  const { org, category, profileName, selectedObjects } = args;
  const client = getClient(org);
  const rows = await runCategory(client, category, profileName, selectedObjects);
  return { org, category, rows };
}

async function runCategory(
  client: SalesforceClient,
  category: PermissionCategory,
  profileName: string,
  selectedObjects?: readonly string[],
): Promise<PermissionRow[]> {
  switch (category) {
    case "object_settings":
      return scrapeObjectSettings(client, profileName, selectedObjects);
    case "system_permissions":
      return scrapeSystemPermissions(client, profileName);
    case "app_permissions":
      return scrapeAppPermissions(client, profileName);
    case "apex_class_access":
      return scrapeApexClassAccess(client, profileName);
    default: {
      const _exhaustive: never = category;
      throw new Error(`Unknown permission category: ${_exhaustive}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Scrapers — one per category
// ─────────────────────────────────────────────────────────────────────────

async function scrapeObjectSettings(
  client: SalesforceClient,
  profileName: string,
  selectedObjects?: readonly string[],
): Promise<PermissionRow[]> {
  const soql = objectSettingsQuery(profileName, selectedObjects);
  const res = await client.query<ToolingQueryResponse<ObjectPermissionRecord>>(
    soql,
    { endpoint: "data" },
  );
  return res.records.map((r) => ({
    key: r.SobjectType,
    category: "object_settings" as const,
    values: {
      PermissionsCreate: Boolean(r.PermissionsCreate),
      PermissionsRead: Boolean(r.PermissionsRead),
      PermissionsEdit: Boolean(r.PermissionsEdit),
      PermissionsDelete: Boolean(r.PermissionsDelete),
      PermissionsViewAllRecords: Boolean(r.PermissionsViewAllRecords),
      PermissionsModifyAllRecords: Boolean(r.PermissionsModifyAllRecords),
    },
  }));
}

async function scrapeSystemPermissions(
  client: SalesforceClient,
  profileName: string,
): Promise<PermissionRow[]> {
  const soql = systemPermissionsQuery(profileName);
  const res = await client.query<ToolingQueryResponse<SystemPermissionRecord>>(
    soql,
    { endpoint: "data" },
  );
  const permissionSet = res.records[0];
  if (!permissionSet) return [];

  // Flatten the curated system-permission flags into one row per flag.
  return SYSTEM_PERMISSION_FIELDS.map((field): PermissionRow => {
    const enabled = Boolean(permissionSet[field]);
    return {
      key: stripPermissionsPrefix(field),
      category: "system_permissions" as const,
      values: { Enabled: enabled },
    };
  });
}

async function scrapeAppPermissions(
  client: SalesforceClient,
  profileName: string,
): Promise<PermissionRow[]> {
  const soql = appPermissionsQuery(profileName);
  const res = await client.query<ToolingQueryResponse<SetupEntityAccessRecord>>(
    soql,
    { endpoint: "data" },
  );

  const setupEntityIds = res.records.map((r) => r.SetupEntityId);
  // Hydrate TabSet metadata. AppDefinition.DurableId is the join key.
  // Some org editions don't expose AppDefinition on any query endpoint —
  // fall back to raw DurableIds in that case so the comparison still runs.
  let labelByDurableId = new Map<string, string>();
  if (setupEntityIds.length > 0) {
    const lookup = tabSetLookupQuery(setupEntityIds);
    if (lookup) {
      try {
        const meta = await client.query<ToolingQueryResponse<TabSetRecord>>(lookup);
        labelByDurableId = new Map(
          meta.records.map((m) => [
            m.DurableId,
            m.Namespace ? `${m.Namespace}__${m.Label}` : m.Label,
          ]),
        );
      } catch (err) {
        console.warn(
          `[scrapeAppPermissions] AppDefinition hydration failed for Org ${client.org}; using raw DurableIds.`,
          err,
        );
      }
    }
  }

  return res.records.map((r): PermissionRow => {
    const label = labelByDurableId.get(r.SetupEntityId) ?? r.SetupEntityId;
    return {
      key: label,
      category: "app_permissions" as const,
      values: { Visible: true },
    };
  });
}

async function scrapeApexClassAccess(
  client: SalesforceClient,
  profileName: string,
): Promise<PermissionRow[]> {
  const soql = apexClassAccessQuery(profileName);
  const res = await client.query<ToolingQueryResponse<SetupEntityAccessRecord>>(
    soql,
    { endpoint: "data" },
  );

  const classIds = res.records.map((r) => r.SetupEntityId);
  let nameById = new Map<string, string>();
  if (classIds.length > 0) {
    const lookup = apexClassLookupQuery(classIds);
    if (lookup) {
      try {
        const meta = await client.query<ToolingQueryResponse<ApexClassRecord>>(
          lookup,
        );
        nameById = new Map(
          meta.records.map((m) => [
            m.Id,
            m.NamespacePrefix ? `${m.NamespacePrefix}__${m.Name}` : m.Name,
          ]),
        );
      } catch (err) {
        console.warn(
          `[scrapeApexClassAccess] ApexClass hydration failed for Org ${client.org}; using raw class IDs.`,
          err,
        );
      }
    }
  }

  return res.records.map((r): PermissionRow => ({
    key: nameById.get(r.SetupEntityId) ?? r.SetupEntityId,
    category: "apex_class_access" as const,
    values: { Enabled: true },
  }));
}

function stripPermissionsPrefix(field: string): string {
  return field.startsWith("Permissions") ? field.slice("Permissions".length) : field;
}
