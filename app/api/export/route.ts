/**
 * app/api/export/route.ts — XLSX download endpoint (B2)
 *
 * Accepts a DiffRow[] payload and metadata, returns either:
 *   - 200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *     with Content-Disposition attachment + PRD-format filename
 *   - 204 No Content when the diff is empty (D4 treats 204 as the
 *     "no differences found" branch per AC-05)
 *
 * POST body:
 *   {
 *     rows: DiffRow[],
 *     meta: { profileName, orgAName, orgBName }
 *   }
 */

import { z } from "zod";
import { buildFilename, generateXlsx } from "@/lib/xlsx/generator";
import type { DiffRow } from "@/lib/diff/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rowSchema = z.object({
  id: z.string(),
  key: z.string(),
  category: z.enum([
    "object_settings",
    "system_permissions",
    "app_permissions",
    "apex_class_access",
  ]),
  valueA: z.record(z.union([z.boolean(), z.string()])).nullable(),
  valueB: z.record(z.union([z.boolean(), z.string()])).nullable(),
  type: z.enum(["missing_in_a", "missing_in_b", "value_mismatch"]),
});

const bodySchema = z.object({
  rows: z.array(rowSchema),
  meta: z.object({
    profileName: z.string().min(1),
    orgAName: z.string().min(1),
    orgBName: z.string().min(1),
  }),
});

export async function POST(req: Request) {
  let parsed;
  try {
    const json = await req.json();
    parsed = bodySchema.parse(json);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Invalid request body", detail: String(err) }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const buffer = generateXlsx(parsed.rows as DiffRow[], parsed.meta);
  if (buffer === null) {
    // AC-05: empty diff → no file, D4 surfaces a chat message instead.
    return new Response(null, { status: 204 });
  }

  const filename = buildFilename(parsed.meta);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
