/**
 * app/api/salesforce/scrape/route.ts — HTTP wrapper for A3 scrape()
 *
 * POST body:
 *   {
 *     category: PermissionCategory,
 *     profileName: string,
 *     orgs: OrgId[],                    // typically ['A','B']
 *     selectedObjects?: string[]        // object_settings only
 *   }
 *
 * Returns:
 *   200 { results: ScrapeResult[] }
 *   400 on validation error
 *   401 on SessionExpiredError (with { org } in body)
 *   500 on anything else, with { error } text
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { scrape } from "@/lib/salesforce/scrape";
import { SessionExpiredError } from "@/lib/salesforce/types";

// Force Node runtime — edge runtime has a shorter timeout than our 10s
// scrape budget + Promise.all overhead, and Tooling API requires fetch.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  category: z.enum([
    "object_settings",
    "system_permissions",
    "app_permissions",
    "apex_class_access",
  ]),
  profileName: z.string().min(1),
  orgs: z.array(z.enum(["A", "B"])).min(1),
  selectedObjects: z.array(z.string().min(1)).optional(),
});

export async function POST(req: Request) {
  let parsed;
  try {
    const json = await req.json();
    parsed = bodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid request body", detail: String(err) },
      { status: 400 },
    );
  }

  try {
    const results = await scrape(parsed);
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      return NextResponse.json(
        { error: "session_expired", org: err.org },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message ?? "Scrape failed" },
      { status: 500 },
    );
  }
}
