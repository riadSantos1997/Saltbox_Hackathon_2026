"use client";

/**
 * app/components/chat/ChatShell.tsx — top-level chat view (C1)
 *
 * Uses Vercel AI SDK `useChat` pointed at `/api/chat`. Handles:
 *   - scroll-to-bottom on new messages
 *   - Enter submits / Shift+Enter newline in the composer
 *   - loading (thinking) indicator while isLoading
 *   - delegating each message's render to `<Message />`
 *
 * Inline tool-invocation rendering lives in Message.tsx (wired in D4).
 */

import { useChat } from "ai/react";
import { useEffect, useRef } from "react";
import { Message } from "./Message";
import type { PermissionCategory } from "@/lib/salesforce/types";

const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  object_settings: "Object Settings",
  system_permissions: "System Permissions",
  app_permissions: "App Permissions",
  apex_class_access: "Apex Class Access",
};

export function ChatShell() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error, append } =
    useChat({
      api: "/api/chat",
      // Keep request body lean — server derives everything from messages.
    });

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading]);

  // Suggestion chips the LLM surfaces via validateProfile → suggestions.
  // We let Message render the chips and call back into this `append`.
  const onSuggestionPick = (profileName: string) => {
    append({ role: "user", content: profileName });
  };

  // Comparison-type card callback (C2). We echo the friendly label back
  // so the LLM can see which category the user picked and call the
  // right tool on the next turn.
  const onCategoryPick = (category: PermissionCategory) => {
    append({
      role: "user",
      content: `I'll compare ${CATEGORY_LABELS[category]} (category=${category}).`,
    });
  };

  // Object picker confirm (C3).
  const onObjectsConfirm = (apiNames: string[]) => {
    append({
      role: "user",
      content: `Run the comparison with these objects: ${apiNames.join(", ")}`,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-neutral-800 px-6 py-4">
        <h1 className="font-mono text-lg tracking-tight text-neutral-100">
          Profile Permission Comparator
        </h1>
        <p className="mt-1 font-mono text-xs text-neutral-500">
          Compare a Salesforce profile across two connected orgs.
        </p>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-6 space-y-4"
        data-testid="chat-scroll"
      >
        {messages.length === 0 && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 font-mono text-sm text-neutral-400">
            <p className="font-semibold text-neutral-200">Try a prompt:</p>
            <p className="mt-1">
              &ldquo;Compare the Sales Rep profile between Production and
              Staging&rdquo;
            </p>
          </div>
        )}

        {messages.map((m) => (
          <Message
            key={m.id}
            message={m}
            onSuggestionPick={onSuggestionPick}
            onCategoryPick={onCategoryPick}
            onObjectsConfirm={onObjectsConfirm}
          />
        ))}

        {isLoading && (
          <div className="font-mono text-xs text-neutral-500">Thinking…</div>
        )}

        {error && (
          <div className="rounded-md border border-red-700 bg-red-950/40 p-3 font-mono text-xs text-red-300">
            {error.message ?? "Something went wrong."}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-neutral-800 bg-neutral-950 px-6 py-4"
      >
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim().length > 0) {
                  handleSubmit(
                    e as unknown as React.FormEvent<HTMLFormElement>,
                  );
                }
              }
            }}
            placeholder="Ask me to compare a profile…"
            rows={1}
            className="flex-1 resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || input.trim().length === 0}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-4 py-2 font-mono text-sm text-neutral-100 transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <p className="mt-2 font-mono text-[10px] text-neutral-600">
          Enter to send · Shift+Enter for newline
        </p>
      </form>
    </div>
  );
}
