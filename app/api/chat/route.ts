/**
 * app/api/chat/route.ts — streaming chat endpoint (D3)
 *
 * Uses Vercel AI SDK `streamText` with the three D2 tools. The LLM is
 * primed (via the system prompt) to:
 *   1. Call `validateProfile` first with the profile name it extracts.
 *   2. If `found === false && suggestions` → present the fuzzy chips
 *      inline and ask the user to pick.
 *   3. If `found === false && missingIn` → halt with "Profile missing
 *      from Org X — please reconnect or pick another profile."
 *   4. Otherwise surface the 4-option comparison-type selector (C2).
 *   5. For `object_settings`, call `listObjects` then wait for the
 *      picker (C3) to confirm before calling `runComparison`.
 *   6. Surface the download link or the no-differences message.
 *
 * Runtime = Node. Edge has a shorter hard timeout than the 10s scrape
 * budget + two sequential Salesforce round trips, per the epic risk.
 */

import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { buildTools } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Give the handler enough runway for a full scrape + diff + XLSX round-trip.
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the Saltbox Profile Permission Comparator — a concise assistant that helps compare Salesforce profile permissions between two connected orgs.

Conversation flow (follow strictly):
1. When the user asks to compare a profile, call the \`validateProfile\` tool with the profile name they gave you.
2. Interpret the tool's response:
   - If it returns \`{ found: true, profile }\` → briefly confirm the profile, then ask the user to pick one of the four comparison categories (Object Settings, System Permissions, App Permissions, Apex Class Access). The UI will render a 4-option selector card automatically — do not list the options yourself, just say "Which category would you like to compare?"
   - If it returns \`{ found: false, missingIn, existsIn, profile }\` → tell the user the profile exists in Org \${existsIn} but is missing from Org \${missingIn}, and halt. Do not continue.
   - If it returns \`{ found: false, suggestions }\` → present the suggestions and ask the user to pick one (the UI will render them as chips).
   - If it returns \`{ error: "session_expired", org }\` → say "Session expired. Please reconnect Org \${org}." and halt.
3. Once the user picks a category:
   - If category is \`object_settings\`, call \`listObjects\` with \`org: "A"\` and tell the user "Select the objects you'd like to compare." The UI renders the picker from the tool result.
   - Otherwise, immediately call \`runComparison\` with \`{ category, profileName }\`.
4. When the user has picked objects (for object_settings), call \`runComparison\` with \`{ category: "object_settings", profileName, selectedObjects }\`.
5. \`runComparison\` returns either:
   - \`{ downloadUrl, filename, rowCount }\` → tell the user "I found \${rowCount} differences — click below to download your report." The UI renders the download button.
   - \`{ noDifferences: true, message }\` → relay the message verbatim.
   - \`{ error: "session_expired", org }\` → "Session expired. Please reconnect Org \${org}."
   - Any other error → apologize briefly and explain what failed.

Rules:
- Be terse. One or two sentences per turn.
- Never expose raw tool-call JSON to the user.
- Never call \`runComparison\` before \`validateProfile\` has confirmed the profile.
- Only one comparison category per conversation.`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "OpenAI API key not configured. Set OPENAI_API_KEY to enable chat.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  let messages;
  try {
    const body = await req.json();
    messages = body.messages;
    if (!Array.isArray(messages)) throw new Error("messages must be an array");
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Invalid request body", detail: String(err) }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Derive an absolute base URL so the tools can call sibling API routes
  // (Next.js route handlers require absolute URLs for fetch).
  const baseUrl = deriveBaseUrl(req);
  const tools = buildTools({ baseUrl });

  try {
    const result = await streamText({
      model: openai("gpt-4o-mini"),
      system: SYSTEM_PROMPT,
      messages,
      tools,
      // Allow enough round-trips for: validate → (listObjects) → runComparison
      // plus the model's narration turns around each.
      maxSteps: 5,
    });
    return result.toDataStreamResponse();
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "chat_failed",
        detail: (err as Error).message ?? String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Reconstruct the origin from the incoming request's headers. In
 * production on Vercel, x-forwarded-* is present; locally, `req.url` is
 * already absolute. Fallback to `req.url` parsed via URL.
 */
function deriveBaseUrl(req: Request): string {
  const headers = req.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  try {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://localhost:3000";
  }
}
