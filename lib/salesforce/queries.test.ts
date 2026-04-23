/**
 * lib/salesforce/queries.test.ts — unit tests for SOQL builders (A3)
 *
 * Verifies each category builder emits a non-empty SOQL string with the
 * PRD-specified clauses, properly escapes profile names to prevent SOQL
 * injection, and respects optional filters (selectedObjects on
 * objectSettingsQuery).
 */

import { describe, expect, it } from "vitest";
import {
  apexClassAccessQuery,
  apexClassLookupQuery,
  appPermissionsQuery,
  objectSettingsQuery,
  SYSTEM_PERMISSION_FIELDS,
  systemPermissionsQuery,
  tabSetLookupQuery,
} from "./queries";

describe("queries — category builders return non-empty SOQL", () => {
  it("objectSettingsQuery returns a non-empty string", () => {
    const q = objectSettingsQuery("Admin");
    expect(typeof q).toBe("string");
    expect(q.length).toBeGreaterThan(0);
    expect(q).toMatch(/^SELECT\s+/i);
  });

  it("systemPermissionsQuery returns a non-empty string", () => {
    const q = systemPermissionsQuery("Admin");
    expect(q.length).toBeGreaterThan(0);
    expect(q).toMatch(/^SELECT\s+/i);
  });

  it("appPermissionsQuery returns a non-empty string", () => {
    const q = appPermissionsQuery("Admin");
    expect(q.length).toBeGreaterThan(0);
    expect(q).toMatch(/^SELECT\s+/i);
  });

  it("apexClassAccessQuery returns a non-empty string", () => {
    const q = apexClassAccessQuery("Admin");
    expect(q.length).toBeGreaterThan(0);
    expect(q).toMatch(/^SELECT\s+/i);
  });
});

describe("queries — profile-name interpolation and escaping", () => {
  it("wraps the profile name in single quotes", () => {
    const q = objectSettingsQuery("Standard User");
    expect(q).toContain("Parent.Profile.Name = 'Standard User'");
  });

  it("escapes embedded single quotes in profile names", () => {
    // "O'Brien" must become O\'Brien inside the SOQL literal so the
    // outer quotes aren't prematurely terminated.
    const q = objectSettingsQuery("O'Brien Admin");
    expect(q).toContain("'O\\'Brien Admin'");
    // Defensive: the literal should not contain an unescaped embedded quote
    // that would break SOQL parsing.
    expect(q).not.toMatch(/'O'Brien/);
  });

  it("escapes backslashes in profile names", () => {
    const q = systemPermissionsQuery("Weird\\Name");
    // Input backslash → doubled backslash in SOQL literal
    expect(q).toContain("'Weird\\\\Name'");
  });

  it("interpolates the profile name into every category builder", () => {
    const name = "Sales Manager";
    expect(objectSettingsQuery(name)).toContain(`'${name}'`);
    expect(systemPermissionsQuery(name)).toContain(`'${name}'`);
    expect(appPermissionsQuery(name)).toContain(`'${name}'`);
    expect(apexClassAccessQuery(name)).toContain(`'${name}'`);
  });
});

describe("objectSettingsQuery — optional selectedObjects filter", () => {
  it("omits the SobjectType IN clause when selectedObjects is not provided", () => {
    const q = objectSettingsQuery("Admin");
    expect(q).not.toMatch(/SobjectType\s+IN\s*\(/i);
  });

  it("omits the SobjectType IN clause when selectedObjects is an empty array", () => {
    const q = objectSettingsQuery("Admin", []);
    expect(q).not.toMatch(/SobjectType\s+IN\s*\(/i);
  });

  it("emits WHERE ... AND SobjectType IN (...) when selectedObjects is provided", () => {
    const q = objectSettingsQuery("Admin", ["Account", "Contact"]);
    expect(q).toMatch(/AND\s+SobjectType\s+IN\s*\(/i);
    expect(q).toContain("'Account'");
    expect(q).toContain("'Contact'");
  });

  it("escapes single quotes inside object names", () => {
    const q = objectSettingsQuery("Admin", ["My'Obj__c"]);
    expect(q).toContain("'My\\'Obj__c'");
  });

  it("selects the expected ObjectPermissions fields", () => {
    const q = objectSettingsQuery("Admin");
    expect(q).toContain("SobjectType");
    expect(q).toContain("PermissionsCreate");
    expect(q).toContain("PermissionsRead");
    expect(q).toContain("PermissionsEdit");
    expect(q).toContain("PermissionsDelete");
    expect(q).toContain("PermissionsViewAllRecords");
    expect(q).toContain("PermissionsModifyAllRecords");
    expect(q).toMatch(/FROM\s+ObjectPermissions/i);
  });
});

describe("systemPermissionsQuery — IsOwnedByProfile clause", () => {
  it("includes IsOwnedByProfile = true so we only get the profile-backed PermissionSet", () => {
    const q = systemPermissionsQuery("Admin");
    expect(q).toMatch(/IsOwnedByProfile\s*=\s*true/i);
  });

  it("queries the PermissionSet table", () => {
    const q = systemPermissionsQuery("Admin");
    expect(q).toMatch(/FROM\s+PermissionSet/i);
  });

  it("selects every configured system-permission field", () => {
    const q = systemPermissionsQuery("Admin");
    for (const field of SYSTEM_PERMISSION_FIELDS) {
      expect(q).toContain(field);
    }
  });
});

describe("appPermissionsQuery — TabSet filter", () => {
  it("filters SetupEntityType = 'TabSet'", () => {
    const q = appPermissionsQuery("Admin");
    expect(q).toMatch(/SetupEntityType\s*=\s*'TabSet'/);
  });

  it("queries the SetupEntityAccess table", () => {
    const q = appPermissionsQuery("Admin");
    expect(q).toMatch(/FROM\s+SetupEntityAccess/i);
  });
});

describe("apexClassAccessQuery — ApexClass filter", () => {
  it("filters SetupEntityType = 'ApexClass'", () => {
    const q = apexClassAccessQuery("Admin");
    expect(q).toMatch(/SetupEntityType\s*=\s*'ApexClass'/);
  });

  it("queries the SetupEntityAccess table", () => {
    const q = apexClassAccessQuery("Admin");
    expect(q).toMatch(/FROM\s+SetupEntityAccess/i);
  });
});

describe("second-pass lookup queries", () => {
  it("tabSetLookupQuery returns empty string for empty input", () => {
    expect(tabSetLookupQuery([])).toBe("");
  });

  it("tabSetLookupQuery emits an IN list for non-empty input", () => {
    const q = tabSetLookupQuery(["01p000000000001", "01p000000000002"]);
    expect(q).toMatch(/FROM\s+AppDefinition/i);
    expect(q).toContain("'01p000000000001'");
    expect(q).toContain("'01p000000000002'");
    expect(q).toMatch(/DurableId\s+IN\s*\(/i);
  });

  it("apexClassLookupQuery returns empty string for empty input", () => {
    expect(apexClassLookupQuery([])).toBe("");
  });

  it("apexClassLookupQuery emits an IN list for non-empty input", () => {
    const q = apexClassLookupQuery(["01p000000000001"]);
    expect(q).toMatch(/FROM\s+ApexClass/i);
    expect(q).toContain("'01p000000000001'");
    expect(q).toMatch(/Id\s+IN\s*\(/i);
  });
});
