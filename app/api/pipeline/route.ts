/**
 * app/api/pipeline/route.ts — D4 server-side convergence endpoint
 *
 * ── SCOPE NOTE ────────────────────────────────────────────────────────
 * D4 in the epic is the end-to-end integration task. Its full spec
 * assumes C1–C3 (chat UI) and D1–D3 (AI SDK chat route, prompt parser,
 * tool definitions) already exist — wiring those into a conversational
 * flow. Those tasks were intentionally left out of the critical-path
 * implementation for this hackathon run.
 *
 * To still prove the critical path converges end-to-end without those
 * upstream pieces, this route reinterprets D4 as a SERVER-SIDE pipeline
 * endpoint: a single POST that runs
 *
 *   scrape(category, profile, [A,B])  →  diff(A, B)  →  generateXlsx()
 *
 * and either streams the XLSX back (with the PRD filename) or returns
 * a JSON { noDifferences: true } per AC-05. This is the convergence
 * gate — when D1–D3 are eventually implemented, the chat route's
 * `runComparison` tool simply calls this endpoint internally.
 * ──────────────────────────────────────────────────────────────────────
 *
 * POST body:
 *   {
 *     profileName: string,
 *     category: PermissionCategory,
 *     orgAName?: string,                  // human-readable labels
 *     orgBName?: string,                  // default to the OrgId letter
 *     selectedObjects?: string[]          // object_settings only
 *   }
 */

import { z } from "zod";
import { scrape } from "@/lib/salesforce/scrape";
import { diff } from "@/lib/diff/engine";
import { buildFilename, generateXlsx } from "@/lib/xlsx/generator";
import { SessionExpiredError } from "@/lib/salesforce/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  profileName: z.string().min(1),
  category: z.enum([
    "object_settings",
    "system_permissions",
    "app_permissions",
    "apex_class_access",
  ]),
  orgAName: z.string().min(1).optional(),
  orgBName: z.string().min(1).optional(),
  selectedObjects: z.array(z.string().min(1)).optional(),
});

export async function POST(req: Request) {
  let parsed;
  try {
    const json = await req.json();
    parsed = bodySchema.parse(json);
  } catch (err) {
    return jsonError(400, "Invalid request body", String(err));
  }

  const meta = {
    profileName: parsed.profileName,
    orgAName: parsed.orgAName ?? "OrgA",
    orgBName: parsed.orgBName ?? "OrgB",
  };

  // 1. Scrape both orgs in parallel (Promise.all lives inside scrape()).
  let results;
  try {
    results = await scrape({
      category: parsed.category,
      profileName: parsed.profileName,
      orgs: ["A", "B"],
      selectedObjects: parsed.selectedObjects,
    });
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      // Same "Session expired — reconnect Org X." signal the chat UI
      // would render in a full D3/D4 implementation.
      return new Response(
        JSON.stringify({ error: "session_expired", org: err.org }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    return jsonError(500, "Scrape failed", (err as Error).message);
  }

  // 2. Run the pure diff.
  const orgAResults = results.filter((r) => r.org === "A");
  const orgBResults = results.filter((r) => r.org === "B");
  const diffRows = diff(orgAResults, orgBResults);

  // 3. AC-05: empty diff → JSON message, no file.
  if (diffRows.length === 0) {
    return new Response(
      JSON.stringify({
        noDifferences: true,
        message: `No differences found between ${meta.orgAName} and ${meta.orgBName} for profile "${meta.profileName}".`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // 4. Generate and stream the XLSX back.
  const buffer = generateXlsx(diffRows, meta);
  if (buffer === null) {
    // Defensive — generateXlsx returns null only for empty input, which
    // we already handled above. Reachable only on a logic bug.
    return jsonError(500, "XLSX generation returned empty buffer");
  }
  const filename = buildFilename(meta);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Diff-Row-Count": String(diffRows.length),
    },
  });
}

function jsonError(status: number, error: string, detail?: string) {
  return new Response(JSON.stringify({ error, detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
