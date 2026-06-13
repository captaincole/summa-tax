"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanItem, PlanItemStatus } from "@/lib/api";
import { cn } from "@/lib/cn";

// Renders Luca's rolling plan from /app/state. Refreshes whenever the parent
// page re-fetches state (after each chat turn / reset). Items keep stable
// ids across status changes so the same row visually transitions
// todo → doing → done. When a row flips to done we keep it visible briefly
// (FADE_OUT_MS) so the user sees the checkmark, then drop it.
//
// Returns null when there's nothing to show — empty plans don't render a
// card at all (per Andrew's "no ceremonial single-item list" rule when zero).

const FADE_OUT_MS = 1100;

interface PlanCardProps {
  plan: PlanItem[];
}

interface DisplayItem extends PlanItem {
  // Once we observe a `done`, we mark it leaving and schedule its removal.
  leaving?: boolean;
}

export function PlanCard({ plan }: PlanCardProps) {
  const [display, setDisplay] = useState<DisplayItem[]>(plan);
  const removalTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Reconcile `display` whenever the upstream plan changes. Items in the new
  // plan replace whatever's in display (preserving the leaving flag isn't
  // needed since once a row is `done` upstream it stays `done`); items
  // missing upstream that aren't already leaving get scheduled to fade.
  useEffect(() => {
    setDisplay((prev) => {
      const incomingById = new Map(plan.map((p) => [p.id, p]));
      const next: DisplayItem[] = [];

      // Items still present upstream — adopt their new status.
      for (const incoming of plan) {
        const wasLeaving = prev.find((p) => p.id === incoming.id)?.leaving;
        if (wasLeaving) {
          // Already on its way out; don't resurrect it just because the
          // upstream snapshot still includes the done row. Once we've
          // committed to fade, finish fading.
          continue;
        }
        next.push(incoming);
      }

      // Items the upstream plan dropped (e.g. Luca rewrote the array without
      // them) that we haven't already scheduled to leave — keep them around
      // briefly with whatever status they had so the disappearance isn't a
      // hard pop-out. We don't have visibility into "was this a deliberate
      // drop or a status flip we missed", so treat both the same.
      for (const old of prev) {
        if (incomingById.has(old.id)) continue;
        if (old.leaving) {
          next.push(old);
          continue;
        }
        next.push({ ...old, leaving: true });
        scheduleRemoval(old.id);
      }

      // Items that are `done` upstream — schedule them to leave too, but
      // keep them visible meanwhile so the checkmark animation reads.
      for (const item of next) {
        if (item.status === "done" && !item.leaving) {
          item.leaving = true;
          scheduleRemoval(item.id);
        }
      }

      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  function scheduleRemoval(id: string) {
    if (removalTimers.current.has(id)) return;
    const timer = setTimeout(() => {
      setDisplay((prev) => prev.filter((p) => p.id !== id));
      removalTimers.current.delete(id);
    }, FADE_OUT_MS);
    removalTimers.current.set(id, timer);
  }

  // Capture timers on mount so the cleanup closure references the same Map
  // instance even after re-renders.
  const timersAtCleanup = removalTimers.current;
  useEffect(() => {
    return () => {
      for (const t of timersAtCleanup.values()) clearTimeout(t);
      timersAtCleanup.clear();
    };
  }, [timersAtCleanup]);

  const activeCount = display.filter((d) => !d.leaving).length;
  const isEmpty = display.length === 0;

  return (
    <section className="card flex-1 min-h-0 flex flex-col">
      <div className="card-header shrink-0">
        <span>Plan</span>
        {activeCount > 0 && (
          <span className="tabular-nums text-ink-muted normal-case tracking-normal">
            {activeCount}
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isEmpty ? (
          <div className="px-5 pb-5 pt-1 text-sm text-ink-muted leading-relaxed">
            Luca&rsquo;s next steps will appear here as he works.
          </div>
        ) : (
          <ul className="px-5 pb-4 space-y-2.5">
            {display.map((item) => (
              <PlanRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PlanRow({ item }: { item: DisplayItem }) {
  const isDoing = item.status === "doing";
  const isDone = item.status === "done";

  return (
    <li
      className={cn(
        "flex items-start gap-2.5 transition-all duration-500",
        item.leaving && "opacity-0 -translate-y-0.5",
      )}
    >
      <StatusIcon status={item.status} />
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "text-sm leading-snug transition-colors duration-300",
            isDoing && "text-ink-primary font-medium",
            isDone && "text-ink-muted line-through decoration-ink-faint/60",
            !isDoing && !isDone && "text-ink-secondary",
          )}
        >
          {item.title}
        </div>
        {item.note && !isDone && (
          <div className="text-[12px] text-ink-muted mt-0.5 leading-snug">
            {item.note}
          </div>
        )}
      </div>
    </li>
  );
}

function StatusIcon({ status }: { status: PlanItemStatus }) {
  if (status === "done") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="shrink-0 mt-[3px] w-3.5 h-3.5 text-emerald-400"
        aria-hidden
      >
        <circle cx="8" cy="8" r="7.5" fill="currentColor" opacity="0.18" />
        <path
          d="M4.5 8.2 6.8 10.5 11.5 5.8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }
  if (status === "doing") {
    return (
      <span
        className="shrink-0 mt-[5px] w-2.5 h-2.5 rounded-full bg-accent animate-pulse-soft"
        aria-label="In progress"
      />
    );
  }
  return (
    <span
      className="shrink-0 mt-[4px] w-3 h-3 rounded-full border border-border-strong"
      aria-label="To do"
    />
  );
}
