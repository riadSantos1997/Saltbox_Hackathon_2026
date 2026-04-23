/**
 * lib/ai/tools.ts — Vercel AI SDK tool definitions (D2)
 *
 * Three tools the chat LLM invokes mid-conversation:
 *   1. validateProfile({ profileName })
 *        → calls /api/salesforce/profiles
 *   2. listObjects({ org })
 *        → calls /api/salesforce/objects?org=A|B
 *   3. runComparison({ category, profileName, orgAName?, orgBName?, selectedObjects? })
 *        → calls /api/pipeline (D4 convergence endpoint which chains
 *          scrape → diff → export); returns either { downloadUrl }
 *          pointing back at /api/pipeline (the browser can re-POST to
 *          download) or { noDifferences: true }.
 *
 * The tools are produced by a factory that takes a `baseUrl` because
 * Next.js route handlers need an absolute URL for fetch — the chat
 * route derives this from the incoming request headers before
 * constructing the tool set.
 *
 * Error handling contract: each tool returns a structured `{ error }`
 * object rather than throwing, so the LLM can narrate the error to the
 * user. Session expiry is surfaced as a distinguished error so D3/D4
 * can render the reconnect prompt.
 */

import { tool } from "ai";
import { z } from "zod";

export interface BuildToolsOptions {
  /** Absolute base URL (e.g. "http://localhost:3000" or the Vercel URL). */
  baseUrl: string;
}

/**
 * Build the three-tool set. Call once per chat request with the
 * request's origin. The returned shape is a `Record<string, Tool>`,
 * ready to pass to `streamText({ tools })`.
 */
export function buildTools(opts: BuildToolsOptions) {
  const { baseUrl } = opts;

  const validateProfileTool = tool({
    description:
      "Validate that a Salesforce profile name exists in both connected orgs. " +
      "Returns { found: true, profile } on exact match in both orgs; " +
      "{ found: false, missingIn, existsIn, profile } when one org has it but the other doesn't; " +
      "or { found: false, suggestions: [...] } with up to 5 fuzzy matches when neither has an exact match.",
    parameters: z.object({
      profileName: z
        .string()
        .min(1)
        .describe("The profile name the user typed, exactly as given."),
    }),
    execute: async ({ profileName }) => {
      try {
        const res = await fetch(`${baseUrl}/api/salesforce/profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileName }),
        });
        if (res.status === 401) {
          const body = await safeJson(res);
          return {
            error: "session_expired",
            org: body?.org ?? "A",
            message: "Session expired. Reconnect the affected org.",
          };
        }
        if (!res.ok) {
          return { error: "lookup_failed", detail: await safeText(res) };
        }
        return await res.json();
      } catch (err) {
        return { error: "network_error", detail: String(err) };
      }
    },
  });

  const listObjectsTool = tool({
    description:
      "List the Salesforce objects available in an org for the Object Picker. " +
      "Use when the user has selected the Object Settings comparison category. " +
      "Returns an array of { apiName, label }. Use org='A' (the reference org) " +
      "unless the user explicitly asks for the other org's objects.",
    parameters: z.object({
      org: z
        .enum(["A", "B"])
        .default("A")
        .describe("Internal org slot — 'A' is the reference org."),
    }),
    execute: async ({ org }) => {
      try {
        const res = await fetch(
          `${baseUrl}/api/salesforce/objects?org=${encodeURIComponent(org)}`,
          { method: "GET" },
        );
        if (res.status === 401) {
          const body = await safeJson(res);
          return {
            error: "session_expired",
            org: body?.org ?? org,
            message: "Session expired. Reconnect the affected org.",
          };
        }
        if (!res.ok) {
          return { error: "listing_failed", detail: await safeText(res) };
        }
        const objects = await res.json();
        return { objects };
      } catch (err) {
        return { error: "network_error", detail: String(err) };
      }
    },
  });

  const runComparisonTool = tool({
    description:
      "Run the end-to-end comparison: scrape both orgs, compute the diff, " +
      "and generate the XLSX report. Returns { downloadUrl } when there are " +
      "differences — the user clicks it to download — or { noDifferences: true } " +
      "when the two orgs match exactly (no file is produced in that case).",
    parameters: z.object({
      category: z
        .enum([
          "object_settings",
          "system_permissions",
          "app_permissions",
          "apex_class_access",
        ])
        .describe("Which of the four permission categories to compare."),
      profileName: z
        .string()
        .min(1)
        .describe("Canonical profile name validated by validateProfile."),
      orgAName: z
        .string()
        .optional()
        .describe(
          "Human-readable label for Org A, e.g. 'Production'. Used in the XLSX filename.",
        ),
      orgBName: z
        .string()
        .optional()
        .describe("Human-readable label for Org B, e.g. 'Staging'."),
      selectedObjects: z
        .array(z.string().min(1))
        .optional()
        .describe(
          "For category='object_settings' only — the apiNames the user picked.",
        ),
    }),
    execute: async (input) => {
      try {
        const res = await fetch(`${baseUrl}/api/pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        if (res.status === 401) {
          const body = await safeJson(res);
          return {
            error: "session_expired",
            org: body?.org ?? "A",
            message: "Session expired. Reconnect the affected org.",
          };
        }

        const contentType = res.headers.get("content-type") ?? "";
        // JSON path — either noDifferences:true (200) or an error.
        if (contentType.includes("application/json")) {
          const body = await safeJson(res);
          if (body?.noDifferences) {
            return {
              noDifferences: true,
              message: body.message ?? "No differences found.",
            };
          }
          if (!res.ok) {
            return { error: "comparison_failed", detail: body };
          }
          return body;
        }

        if (!res.ok) {
          return { error: "comparison_failed", detail: await safeText(res) };
        }

        // Binary XLSX path. We don't stream the file through the LLM —
        // instead we return a downloadUrl the browser can POST to. The
        // filename hint comes from the Content-Disposition header.
        const filename = extractFilename(
          res.headers.get("content-disposition") ?? "",
        );
        return {
          downloadUrl: "/api/pipeline",
          downloadPayload: input,
          filename,
          rowCount: Number(res.headers.get("x-diff-row-count") ?? 0),
        };
      } catch (err) {
        return { error: "network_error", detail: String(err) };
      }
    },
  });

  return {
    validateProfile: validateProfileTool,
    listObjects: listObjectsTool,
    runComparison: runComparisonTool,
  };
}

// ─────────────────────────────────────────────────────────────────────────

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}

function extractFilename(disposition: string): string | undefined {
  const m = disposition.match(/filename="?([^"]+)"?/i);
  return m?.[1];
}
