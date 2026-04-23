"use client";

/**
 * app/components/selectors/ComparisonTypeSelector.tsx — 4-option card (C2)
 *
 * Inline chat component that presents the four PermissionCategory
 * options as distinct tappable cards. Once the user picks one, all
 * four cards lock (disabled) and the callback fires. Keyboard
 * accessible: Tab to move, Enter/Space to activate.
 *
 * Implements F-02 / AC-03.
 */

import { useState } from "react";
import type { PermissionCategory } from "@/lib/salesforce/types";

export interface ComparisonTypeSelectorProps {
  onSelect: (category: PermissionCategory) => void;
  /**
   * If set, the card is rendered as already-locked on the given
   * category. D4 uses this when re-rendering a past turn's tool call.
   */
  locked?: PermissionCategory;
}

interface Option {
  id: PermissionCategory;
  label: string;
  blurb: string;
}

const OPTIONS: readonly Option[] = [
  {
    id: "object_settings",
    label: "Object Settings",
    blurb: "CRUD + View/Modify All per SObject",
  },
  {
    id: "system_permissions",
    label: "System Permissions",
    blurb: "Org-wide boolean flags",
  },
  {
    id: "app_permissions",
    label: "App Permissions",
    blurb: "Visible apps / tab sets",
  },
  {
    id: "apex_class_access",
    label: "Apex Class Access",
    blurb: "Classes this profile can run",
  },
];

export function ComparisonTypeSelector({
  onSelect,
  locked,
}: ComparisonTypeSelectorProps) {
  const [picked, setPicked] = useState<PermissionCategory | null>(
    locked ?? null,
  );

  const handlePick = (id: PermissionCategory) => {
    if (picked !== null) return; // already locked
    setPicked(id);
    onSelect(id);
  };

  return (
    <div
      className="mt-2 grid grid-cols-2 gap-2"
      role="radiogroup"
      aria-label="Comparison type"
    >
      {OPTIONS.map((opt) => {
        const isPicked = picked === opt.id;
        const isDisabled = picked !== null && !isPicked;
        return (
          <button
            type="button"
            key={opt.id}
            role="radio"
            aria-checked={isPicked}
            aria-disabled={isDisabled}
            tabIndex={isDisabled ? -1 : 0}
            disabled={isDisabled}
            onClick={() => handlePick(opt.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handlePick(opt.id);
              }
            }}
            className={[
              "text-left rounded-md border px-3 py-3 font-mono text-sm transition",
              "focus:outline-none focus:ring-2 focus:ring-neutral-500",
              isPicked
                ? "border-emerald-600 bg-emerald-950/40 text-emerald-200"
                : isDisabled
                  ? "border-neutral-800 bg-neutral-950 text-neutral-600 cursor-not-allowed"
                  : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:border-neutral-500 hover:bg-neutral-800",
            ].join(" ")}
          >
            <div className="font-semibold">{opt.label}</div>
            <div className="mt-1 text-xs text-neutral-400">{opt.blurb}</div>
          </button>
        );
      })}
    </div>
  );
}
