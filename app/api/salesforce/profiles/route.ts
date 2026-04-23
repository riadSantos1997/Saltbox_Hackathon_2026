/**
 * app/api/salesforce/profiles/route.ts — profile validation endpoint (A2)
 *
 * POST body:
 *   { profileName: string }
 *
 * The two orgs being compared live in the server-side session store
 * (see lib/salesforce/session.ts) and are addressed internally by the
 * slot IDs "A" and "B" — those labels are INTERNAL to this server and
 * do not map to any user-visible org name. Callers (including D2's
 * `validateProfile` tool) pass along human-readable names separately
 * when they need to render messages.
 *
 * Returns one of:
 *   200 { found: true, profile, fromOrg }
 *   200 { found: false, missingIn, existsIn, profile }
 *   200 { found: false, suggestions: [...] }
 *   400 on validation error
 *   401 on SessionExpiredError
 *   500 on unexpected error
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { validateProfile } from "@/lib/salesforce/profiles";
import { SessionExpiredError } from "@/lib/salesforce/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  profileName: z.string().min(1),
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
    const result = await validateProfile(parsed.profileName);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      return NextResponse.json(
        { error: "session_expired", org: err.org },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message ?? "Profile lookup failed" },
      { status: 500 },
    );
  }
}
