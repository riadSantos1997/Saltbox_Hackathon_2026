/**
 * app/api/salesforce/objects/route.ts — object-list endpoint (A4)
 *
 * GET /api/salesforce/objects?org=A
 *   → 200 [{ apiName, label }]  (sorted alphabetically by apiName)
 *   → 401 on SessionExpiredError
 *   → 500 on other failures
 *
 * Feeds Stream C's ObjectPicker. Queries the Tooling API's
 * EntityDefinition table once and maps QualifiedApiName → apiName.
 */

import { NextResponse } from "next/server";
import { getClient } from "@/lib/salesforce/client";
import {
  SessionExpiredError,
  type OrgId,
  type ToolingQueryResponse,
} from "@/lib/salesforce/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EntityDefinitionRecord {
  QualifiedApiName: string;
  Label?: string | null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgParam = url.searchParams.get("org");
  if (orgParam !== "A" && orgParam !== "B") {
    return NextResponse.json(
      { error: "Missing or invalid ?org query parameter (expected 'A' or 'B')" },
      { status: 400 },
    );
  }
  const org: OrgId = orgParam;

  try {
    const client = getClient(org);
    // Keep the SOQL bounded — EntityDefinition has thousands of rows on
    // large orgs but only custom + standard user-accessible objects are
    // useful in the picker. Filter out system-only types.
    const res = await client.query<
      ToolingQueryResponse<EntityDefinitionRecord>
    >(
      "SELECT QualifiedApiName, Label FROM EntityDefinition " +
        "WHERE IsCustomizable = true " +
        "ORDER BY QualifiedApiName ASC",
    );
    const objects = (res.records ?? [])
      .filter((r) => !!r.QualifiedApiName)
      .map((r) => ({
        apiName: r.QualifiedApiName,
        label: r.Label ?? r.QualifiedApiName,
      }))
      .sort((a, b) => a.apiName.localeCompare(b.apiName));
    return NextResponse.json(objects);
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      return NextResponse.json(
        { error: "session_expired", org: err.org },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message ?? "Object list fetch failed" },
      { status: 500 },
    );
  }
}
