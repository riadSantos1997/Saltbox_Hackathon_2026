"use client";

/**
 * app/components/selectors/ObjectPicker.tsx — searchable object picker (C3)
 *
 * Inline checkbox list for the Object Settings flow. Fetches
 * /api/salesforce/objects?org=A on mount when no pre-loaded list is
 * supplied (D4's tool-result pathway passes them in directly, skipping
 * the network round-trip). Search filters client-side per-keystroke;
 * Select All toggles every currently-visible filtered item; Run
 * Comparison is disabled until ≥1 checkbox is checked.
 *
 * Virtualizes with react-window when the filtered list exceeds 50
 * items to keep the DOM under control on large orgs.
 *
 * Implements F-03 / AC-04.
 */

import { useEffect, useMemo, useState } from "react";
import { List, type RowComponentProps } from "react-window";

export interface ObjectItem {
  apiName: string;
  label: string;
}

export interface ObjectPickerProps {
  /** Pre-loaded objects (from the listObjects tool result). When omitted, the component fetches. */
  objects?: ObjectItem[];
  /** Callback fired with the selected apiNames when "Run Comparison" is clicked. */
  onConfirm: (selectedApiNames: string[]) => void;
  /** Org slot to query when `objects` is not supplied. Defaults to 'A'. */
  org?: "A" | "B";
  /** If true, the picker is locked and cannot be edited. D4 uses this after run. */
  locked?: boolean;
}

const VIRTUALIZE_THRESHOLD = 50;
const ROW_HEIGHT = 36;

/** Extra props react-window passes through via `rowProps`. */
interface VirtualRowProps {
  filtered: ObjectItem[];
  selected: Set<string>;
  locked: boolean;
  onToggle: (apiName: string) => void;
}

function VirtualRow({
  index,
  style,
  filtered,
  selected,
  locked,
  onToggle,
}: RowComponentProps<VirtualRowProps>) {
  const o = filtered[index];
  if (!o) return null;
  return (
    <div style={style}>
      <ObjectRow
        item={o}
        checked={selected.has(o.apiName)}
        disabled={locked}
        onToggle={onToggle}
      />
    </div>
  );
}

export function ObjectPicker({
  objects: initialObjects,
  onConfirm,
  org = "A",
  locked = false,
}: ObjectPickerProps) {
  const [objects, setObjects] = useState<ObjectItem[]>(initialObjects ?? []);
  const [loading, setLoading] = useState(!initialObjects);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (initialObjects) return; // already have them
    let cancelled = false;
    setLoading(true);
    fetch(`/api/salesforce/objects?org=${encodeURIComponent(org)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await safeJson(res);
          throw new Error(
            body?.error === "session_expired"
              ? `Session expired. Reconnect Org ${body.org}.`
              : body?.error ?? `Failed to load objects (${res.status})`,
          );
        }
        return res.json() as Promise<ObjectItem[]>;
      })
      .then((list) => {
        if (!cancelled) setObjects(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message ?? String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialObjects, org]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return objects;
    return objects.filter(
      (o) =>
        o.apiName.toLowerCase().includes(q) ||
        (o.label ?? "").toLowerCase().includes(q),
    );
  }, [objects, query]);

  const toggle = (apiName: string) => {
    if (locked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(apiName)) next.delete(apiName);
      else next.add(apiName);
      return next;
    });
  };

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((o) => selected.has(o.apiName));

  const onSelectAll = () => {
    if (locked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((o) => next.delete(o.apiName));
      } else {
        filtered.forEach((o) => next.add(o.apiName));
      }
      return next;
    });
  };

  const virtualize = filtered.length > VIRTUALIZE_THRESHOLD;

  return (
    <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950 p-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter objects…"
          disabled={locked || loading}
          className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={onSelectAll}
          disabled={locked || filtered.length === 0}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {allVisibleSelected ? "Unselect All" : "Select All"}
        </button>
      </div>

      <div className="mt-2 min-h-[120px]">
        {loading && (
          <div className="py-6 text-center font-mono text-xs text-neutral-500">
            Loading objects…
          </div>
        )}
        {error && (
          <div className="rounded border border-red-800 bg-red-950/40 px-2 py-2 font-mono text-xs text-red-300">
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="py-6 text-center font-mono text-xs text-neutral-500">
            No objects match &ldquo;{query}&rdquo;.
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="max-h-64 overflow-y-auto">
            {virtualize ? (
              <List
                rowComponent={VirtualRow}
                rowCount={filtered.length}
                rowHeight={ROW_HEIGHT}
                rowProps={{
                  filtered,
                  selected,
                  locked,
                  onToggle: toggle,
                }}
                style={{ height: 256 }}
              />
            ) : (
              filtered.map((o) => (
                <ObjectRow
                  key={o.apiName}
                  item={o}
                  checked={selected.has(o.apiName)}
                  disabled={locked}
                  onToggle={toggle}
                />
              ))
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[10px] text-neutral-500">
          {selected.size} selected · {filtered.length}/{objects.length} shown
        </span>
        <button
          type="button"
          onClick={() => onConfirm([...selected])}
          disabled={locked || selected.size === 0}
          className="rounded-md border border-emerald-700 bg-emerald-900/60 px-3 py-1.5 font-mono text-xs text-emerald-100 transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Run Comparison
        </button>
      </div>
    </div>
  );
}

function ObjectRow({
  item,
  checked,
  disabled,
  onToggle,
}: {
  item: ObjectItem;
  checked: boolean;
  disabled: boolean;
  onToggle: (apiName: string) => void;
}) {
  return (
    <label
      style={{ height: ROW_HEIGHT }}
      className="flex cursor-pointer items-center gap-2 rounded px-1 font-mono text-xs text-neutral-200 hover:bg-neutral-900"
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(item.apiName)}
        className="h-3.5 w-3.5 accent-emerald-500"
      />
      <span className="flex-1 truncate">
        <span className="text-neutral-100">{item.apiName}</span>
        {item.label && item.label !== item.apiName && (
          <span className="ml-2 text-neutral-500">{item.label}</span>
        )}
      </span>
    </label>
  );
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
