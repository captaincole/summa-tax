"use client";

import { useEffect, useState } from "react";
import { fetchActivityItems, type ActivityItem, type Verdict } from "@/lib/activity";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

interface ActivityCardProps {
  // Bumped by the parent when activity may have changed (new turn, reset, etc).
  refreshKey: number;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  pending: "Reviewing…",
  accurate: "Grounded",
  inaccurate: "Conflict",
  ungroundable: "No source",
  needs_more_facts: "Needs info",
  review_failed: "Review failed",
};

const VERDICT_TONE: Record<Verdict, string> = {
  pending: "text-ink-secondary bg-bg-elevated animate-pulse-soft",
  accurate: "text-emerald-400 bg-emerald-400/10",
  inaccurate: "text-red-400 bg-red-400/10",
  ungroundable: "text-amber-400 bg-amber-400/10",
  needs_more_facts: "text-amber-400 bg-amber-400/10",
  review_failed: "text-ink-muted bg-bg-elevated",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

function formatTitle(rawKey: string, dropFirstSegment: boolean): string {
  const parts = rawKey.split(".");
  const visible = dropFirstSegment ? parts.slice(1) : parts;
  if (visible.length === 0) return rawKey;
  return visible
    .map((part, i) => {
      const words = part.replace(/_/g, " ");
      return i === 0 ? words.charAt(0).toUpperCase() + words.slice(1) : words;
    })
    .join(" · ");
}

function formatFieldLabel(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v.length === 0 ? "—" : v.map(formatScalar).join(", ");
  }
  return JSON.stringify(v);
}

function brief(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "object" || Array.isArray(value)) {
    return formatScalar(value);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 2)
    .map(([k, v]) => `${formatFieldLabel(k)}: ${formatScalar(v)}`)
    .join(" · ");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function ActivityCard({ refreshKey }: ActivityCardProps) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchActivityItems(createClient(), 50)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        console.warn("[activity] fetch failed:", err);
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="card flex-1 min-h-0 flex flex-col">
      <div className="card-header shrink-0">
        <span>Activity</span>
        <span className="tabular-nums text-ink-muted normal-case tracking-normal">
          {items?.length ?? 0}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {items === null && (
          <div className="px-5 py-6 text-sm text-ink-muted">Loading…</div>
        )}
        {items?.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-ink-muted">
            Nothing recorded yet. Start a chat to populate the ledger.
          </div>
        )}
        {items?.map((item, idx) => (
          <ActivityRow
            key={item.id}
            item={item}
            isFirst={idx === 0}
            isExpanded={expanded.has(item.id)}
            onToggle={() => toggle(item.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ActivityRow({
  item,
  isFirst,
  isExpanded,
  onToggle,
}: {
  item: ActivityItem;
  isFirst: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isDecision = item.kind === "decision";
  const title = formatTitle(item.title, isDecision);

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full text-left px-5 py-3.5",
        "hover:bg-bg-elevated/50 transition-colors",
        !isFirst && "border-t border-border-subtle",
      )}
      aria-expanded={isExpanded}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "text-[9px] uppercase tracking-[0.18em] font-medium",
            isDecision ? "text-accent" : "text-ink-muted",
          )}
        >
          {item.kind}
        </span>
        <span className="text-[11px] text-ink-faint tabular-nums">
          {timeAgo(item.createdAt)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2 text-ink-primary">
        <span className="text-sm font-medium truncate">{title}</span>
        <span
          className={cn(
            "ml-auto shrink-0 text-ink-muted text-xs transition-transform duration-150",
            isExpanded && "rotate-90",
          )}
          aria-hidden
        >
          ▸
        </span>
      </div>

      {!isExpanded && (
        <div className="mt-1 text-sm text-ink-secondary truncate">
          {brief(item.value)}
        </div>
      )}

      {isExpanded && <ExpandedBody item={item} />}

      {isDecision && item.verdict && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide",
              VERDICT_TONE[item.verdict],
            )}
          >
            {VERDICT_LABEL[item.verdict]}
          </span>
          {item.confidence && (
            <span className="text-[10px] text-ink-muted uppercase tracking-wide">
              {item.confidence} confidence
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function ExpandedBody({ item }: { item: ActivityItem }) {
  return (
    <div className="mt-3 space-y-3 text-sm">
      <ValueDisplay value={item.value} />

      {item.kind === "decision" && item.rationale && (
        <DetailBlock label="Why">
          <p className="text-ink-secondary leading-relaxed whitespace-pre-wrap">
            {item.rationale}
          </p>
        </DetailBlock>
      )}

      {item.kind === "decision" &&
        item.verdictReason &&
        item.verdict !== "accurate" && (
          <DetailBlock label="Reviewer note">
            <p className="text-ink-secondary leading-relaxed whitespace-pre-wrap">
              {item.verdictReason}
            </p>
          </DetailBlock>
        )}

      {item.kind === "decision" &&
        item.supportingFactKeys &&
        item.supportingFactKeys.length > 0 && (
          <DetailBlock label="Supporting facts">
            <ul className="space-y-0.5">
              {item.supportingFactKeys.map((k) => (
                <li
                  key={k}
                  className="text-ink-secondary font-mono text-[12px] truncate"
                >
                  {k}
                </li>
              ))}
            </ul>
          </DetailBlock>
        )}

      {item.sourceNote && (
        <DetailBlock label="Source">
          <p className="text-ink-secondary text-[13px]">{item.sourceNote}</p>
        </DetailBlock>
      )}

      <div className="text-ink-faint text-[11px] font-mono pt-1">
        {item.title}
      </div>
    </div>
  );
}

function DetailBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

function ValueDisplay({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="text-ink-secondary">—</p>;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <p className="text-ink-secondary">—</p>;
    }
    return (
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[11px] uppercase tracking-wide text-ink-muted pt-0.5">
              {formatFieldLabel(k)}
            </dt>
            <dd className="text-ink-primary break-words">{formatScalar(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <p className="text-ink-primary break-words">{formatScalar(value)}</p>
  );
}
