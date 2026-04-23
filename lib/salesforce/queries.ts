/**
 * lib/salesforce/queries.ts — SOQL builders (A3)
 *
 * Pure functions that return SOQL strings for each of the four permission
 * categories. Kept separate from scrape.ts so they can be unit-tested
 * without touching the network and so they're easy to diff in code
 * review — every query is a PRD-specified shape.
 *
 * All builders escape single quotes in user-supplied input (profile
 * name, object names) to prevent SOQL injection.
 */

/** Escape single quotes in user input so it can be embedded in SOQL. */
function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Join a list of quoted identifiers for `IN (...)` clauses. */
function inList(values: readonly string[]): string {
  return values.map((v) => `'${esc(v)}'`).join(", ");
}

/** Object Settings: CRUD + ViewAll/ModifyAll per SobjectType. */
export function objectSettingsQuery(
  profileName: string,
  selectedObjects?: readonly string[],
): string {
  const base =
    "SELECT SobjectType, PermissionsCreate, PermissionsRead, " +
    "PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, " +
    "PermissionsModifyAllRecords " +
    "FROM ObjectPermissions " +
    `WHERE Parent.Profile.Name = '${esc(profileName)}'`;
  if (selectedObjects && selectedObjects.length > 0) {
    return `${base} AND SobjectType IN (${inList(selectedObjects)})`;
  }
  return base;
}

/**
 * System Permissions: boolean flags on the PermissionSet that backs a
 * profile (IsOwnedByProfile = true). We pull a curated set of known
 * system permissions; the flattener in scrape.ts will emit one row per
 * flag that is present and true.
 *
 * This list is the minimum viable set for the demo — it covers the
 * commonly-flagged permissions deployment teams compare (ModifyAllData,
 * ViewAllData, ViewSetup, etc.). Expand as needed.
 */
export const SYSTEM_PERMISSION_FIELDS: readonly string[] = [
  "PermissionsModifyAllData",
  "PermissionsViewAllData",
  "PermissionsViewSetup",
  "PermissionsCustomizeApplication",
  "PermissionsApiEnabled",
  "PermissionsManageUsers",
  "PermissionsManageProfilesPermissionsets",
  "PermissionsAssignPermissionSets",
  "PermissionsManageRoles",
  "PermissionsRunReports",
  "PermissionsExportReport",
  "PermissionsManageDashboards",
  "PermissionsScheduleReports",
  "PermissionsEditPublicReports",
  "PermissionsEditPublicFilters",
  "PermissionsManageSharing",
  "PermissionsManageCallCenters",
  "PermissionsPasswordNeverExpires",
];

export function systemPermissionsQuery(profileName: string): string {
  const fields = ["Id", ...SYSTEM_PERMISSION_FIELDS].join(", ");
  return (
    `SELECT ${fields} FROM PermissionSet ` +
    `WHERE IsOwnedByProfile = true AND Profile.Name = '${esc(profileName)}'`
  );
}

/**
 * App Permissions: SetupEntityAccess joined with TabSet. We pull the
 * SetupEntityId so scrape.ts can hydrate TabSet names in a second pass.
 */
export function appPermissionsQuery(profileName: string): string {
  return (
    "SELECT Id, SetupEntityId, SetupEntityType " +
    "FROM SetupEntityAccess " +
    `WHERE Parent.Profile.Name = '${esc(profileName)}' ` +
    "AND SetupEntityType = 'TabSet'"
  );
}

/** Second-pass lookup — resolve TabSet IDs to human-readable labels. */
export function tabSetLookupQuery(setupEntityIds: readonly string[]): string {
  if (setupEntityIds.length === 0) return "";
  return (
    "SELECT Id, Label, Namespace, DurableId " +
    "FROM AppDefinition " +
    `WHERE DurableId IN (${inList(setupEntityIds)})`
  );
}

/** Apex Class Access: SetupEntityAccess where SetupEntityType='ApexClass'. */
export function apexClassAccessQuery(profileName: string): string {
  return (
    "SELECT Id, SetupEntityId, SetupEntityType " +
    "FROM SetupEntityAccess " +
    `WHERE Parent.Profile.Name = '${esc(profileName)}' ` +
    "AND SetupEntityType = 'ApexClass'"
  );
}

/** Second-pass lookup — resolve ApexClass IDs to class names. */
export function apexClassLookupQuery(classIds: readonly string[]): string {
  if (classIds.length === 0) return "";
  return `SELECT Id, Name, NamespacePrefix FROM ApexClass WHERE Id IN (${inList(classIds)})`;
}
