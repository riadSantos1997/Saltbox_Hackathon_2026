"use client";

/**
 * app/components/chat/Message.tsx — single message renderer (C1 + D4)
 *
 * Renders user and assistant messages. Assistant messages may include
 * `toolInvocations` from the AI SDK — D4 wires those into real inline
 * components:
 *   - validateProfile → fuzzy chips (on suggestions) or nothing
 *     (happy-path; the LLM narrates and the next assistant turn
 *     surfaces the category selector via a separate mechanism)
 *   - listObjects → ObjectPicker with pre-loaded items
 *   - runComparison → download button or no-differences notice
 *
 * The 4-option ComparisonTypeSelector is rendered after a successful
 * validateProfile tool call completes, so the user can pick inline.
 */

import type { Message as AIMessage, ToolInvocation } from "ai";
import type { PermissionCategory } from "@/lib/salesforce/types";
import { ComparisonTypeSelector } from "../selectors/ComparisonTypeSelector";
import { ObjectPicker, type ObjectItem } from "../selectors/ObjectPicker";

export interface MessageProps {
  message: AIMessage;
  onSuggestionPick: (profileName: string) => void;
  onCategoryPick: (category: PermissionCategory) => void;
  onObjectsConfirm: (apiNames: string[]) => void;
}

export function Message({
  message,
  onSuggestionPick,
  onCategoryPick,
  onObjectsConfirm,
}: MessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-role={message.role}
    >
      <div
        className={[
          "max-w-[85%] rounded-lg border px-4 py-3",
          isUser
            ? "border-neutral-700 bg-neutral-800 text-neutral-100"
            : "border-neutral-800 bg-neutral-900/70 text-neutral-100",
        ].join(" ")}
      >
        {message.content && (
          <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
            {message.content}
          </div>
        )}

        {Array.isArray(message.toolInvocations) &&
          message.toolInvocations.map((t) => (
            <ToolRender
              key={t.toolCallId}
              invocation={t}
              onSuggestionPick={onSuggestionPick}
              onCategoryPick={onCategoryPick}
              onObjectsConfirm={onObjectsConfirm}
            />
          ))}
      </div>
    </div>
  );
}

/**
 * Dispatches each tool invocation to the right inline component. Only
 * renders when the tool has a result — mid-flight tool calls show a
 * compact "running…" chip.
 */
function ToolRender({
  invocation,
  onSuggestionPick,
  onCategoryPick,
  onObjectsConfirm,
}: {
  invocation: ToolInvocation;
  onSuggestionPick: (profileName: string) => void;
  onCategoryPick: (category: PermissionCategory) => void;
  onObjectsConfirm: (apiNames: string[]) => void;
}) {
  if (invocation.state !== "result") {
    return (
      <div className="mt-3 rounded border border-neutral-800 bg-neutral-900/60 px-3 py-2 font-mono text-xs text-neutral-500">
        <span className="text-neutral-600">tool:</span>{" "}
        <span className="text-neutral-300">{invocation.toolName}</span>{" "}
        <span className="text-neutral-500">running…</span>
      </div>
    );
  }

  const result = (invocation as { result: unknown }).result as Record<
    string,
    any
  >;

  // Distinguished session_expired error (from any tool).
  if (result?.error === "session_expired") {
    return (
      <div className="mt-3 rounded border border-amber-700 bg-amber-950/40 px-3 py-2 font-mono text-xs text-amber-200">
        Session expired. Reconnect Org {result.org ?? "A"}.
      </div>
    );
  }

  // Generic error surface — render whatever the LLM narrated alongside.
  if (result?.error) {
    return (
      <div className="mt-3 rounded border border-red-800 bg-red-950/40 px-3 py-2 font-mono text-xs text-red-300">
        {String(result.error)}
        {result.detail ? `: ${typeof result.detail === "string" ? result.detail : JSON.stringify(result.detail)}` : ""}
      </div>
    );
  }

  switch (invocation.toolName) {
    case "validateProfile":
      return (
        <ValidateProfileResult
          result={result}
          onSuggestionPick={onSuggestionPick}
          onCategoryPick={onCategoryPick}
        />
      );
    case "listObjects":
      return (
        <ListObjectsResult result={result} onObjectsConfirm={onObjectsConfirm} />
      );
    case "runComparison":
      return <RunComparisonResult result={result} />;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// validateProfile rendering
// ─────────────────────────────────────────────────────────────────────────

function ValidateProfileResult({
  result,
  onSuggestionPick,
  onCategoryPick,
}: {
  result: Record<string, any>;
  onSuggestionPick: (profileName: string) => void;
  onCategoryPick: (category: PermissionCategory) => void;
}) {
  // Happy path — profile confirmed in both orgs. Surface the category selector.
  if (result?.found === true) {
    return <ComparisonTypeSelector onSelect={onCategoryPick} />;
  }

  // Missing-in-one-org: the LLM handles the narration; nothing to add.
  if (result?.found === false && result?.missingIn) {
    return null;
  }

  // Fuzzy suggestions → chips.
  if (
    result?.found === false &&
    Array.isArray(result?.suggestions) &&
    result.suggestions.length > 0
  ) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {result.suggestions.map(
          (s: { name: string; label?: string; inOrgs?: string[] }) => (
            <button
              key={s.name}
              type="button"
              onClick={() => onSuggestionPick(s.name)}
              className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 font-mono text-xs text-neutral-100 transition hover:border-emerald-600 hover:bg-emerald-950/40"
            >
              {s.name}
              {s.inOrgs && s.inOrgs.length > 0 && (
                <span className="ml-2 text-neutral-500">
                  ({s.inOrgs.join(",")})
                </span>
              )}
            </button>
          ),
        )}
      </div>
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// listObjects rendering
// ─────────────────────────────────────────────────────────────────────────

function ListObjectsResult({
  result,
  onObjectsConfirm,
}: {
  result: Record<string, any>;
  onObjectsConfirm: (apiNames: string[]) => void;
}) {
  const objects = Array.isArray(result?.objects)
    ? (result.objects as ObjectItem[])
    : [];
  return <ObjectPicker objects={objects} onConfirm={onObjectsConfirm} />;
}

// ─────────────────────────────────────────────────────────────────────────
// runComparison rendering — download button or no-diff notice
// ─────────────────────────────────────────────────────────────────────────

function RunComparisonResult({ result }: { result: Record<string, any> }) {
  if (result?.noDifferences) {
    return (
      <div className="mt-3 rounded border border-emerald-700 bg-emerald-950/30 px-3 py-2 font-mono text-xs text-emerald-200">
        {result.message ?? "No differences found between Org A and Org B."}
      </div>
    );
  }

  if (result?.downloadUrl && result?.downloadPayload) {
    return (
      <DownloadButton
        url={String(result.downloadUrl)}
        payload={result.downloadPayload}
        filename={
          typeof result.filename === "string" ? result.filename : undefined
        }
        rowCount={
          typeof result.rowCount === "number" ? result.rowCount : undefined
        }
      />
    );
  }

  return null;
}

function DownloadButton({
  url,
  payload,
  filename,
  rowCount,
}: {
  url: string;
  payload: unknown;
  filename?: string;
  rowCount?: number;
}) {
  const onClick = async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // Best-effort error surfacing — production would show a toast.
        const body = await res.text();
        alert(`Download failed: ${body || res.status}`);
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename ?? "profile-comparison.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      alert(`Download error: ${String(err)}`);
    }
  };

  return (
    <div className="mt-3 flex items-center justify-between rounded border border-emerald-700 bg-emerald-950/30 px-3 py-2">
      <div className="font-mono text-xs text-emerald-100">
        {typeof rowCount === "number" ? `${rowCount} differences` : "Report ready"}
        {filename ? ` · ${filename}` : ""}
      </div>
      <button
        type="button"
        onClick={onClick}
        className="rounded border border-emerald-600 bg-emerald-900/60 px-3 py-1.5 font-mono text-xs text-emerald-50 transition hover:bg-emerald-800"
      >
        Download XLSX
      </button>
    </div>
  );
}
