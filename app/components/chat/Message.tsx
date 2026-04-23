"use client";

/**
 * app/components/chat/Message.tsx — single message renderer (C1)
 *
 * Renders user and assistant messages. Assistant messages may include
 * `toolInvocations` from the AI SDK — each of those can optionally
 * render an inline component (fuzzy chips, comparison-type selector,
 * object picker, download button). C1 ships the slot plumbing; D4
 * wires the actual selector/picker components.
 */

import type { Message as AIMessage } from "ai";

export interface MessageProps {
  message: AIMessage;
  onSuggestionPick: (profileName: string) => void;
  onCategoryPick: (category: string) => void;
  onObjectsConfirm: (apiNames: string[]) => void;
}

export function Message({ message }: MessageProps) {
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
        {/*
          Tool-invocation UI slot — D4 replaces the raw JSON dump with
          the inline selector / picker / download-button components.
        */}
        {Array.isArray(message.toolInvocations) &&
          message.toolInvocations.length > 0 && (
            <div className="mt-3 space-y-2">
              {message.toolInvocations.map((t) => (
                <div
                  key={t.toolCallId}
                  className="rounded border border-neutral-800 bg-neutral-900/60 px-3 py-2 font-mono text-xs text-neutral-400"
                >
                  <span className="text-neutral-500">tool:</span>{" "}
                  <span className="text-neutral-300">{t.toolName}</span>{" "}
                  <span className="text-neutral-500">
                    ({t.state === "result" ? "done" : "running…"})
                  </span>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
