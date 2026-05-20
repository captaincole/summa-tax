"use client";

// Home tab for the active return. Synthesized dashboard:
//   - Progress card with clickable category drill-downs
//   - Plan + Open asks side-by-side
//   - Activity (inline expand for full ledger)
//
// Real data comes from useAppShell() — state.forms, state.plan,
// state.pendingFacts, state.pendingDecisions. The category sub-items are
// static for now (no categorization endpoint yet); the per-category pct
// uses a hand-rolled mapping until we wire it server-side.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAppShell } from "@/components/AppShell";
import { computeOverallPct, type FormSummary } from "@/lib/api";
import {
  ACTIVITY_TAX_YEAR,
  decisionRowToItem,
  factRowToItem,
  fetchActivityItems,
  type ActivityItem,
  type Verdict,
} from "@/lib/activity";
import {
  fetchOpenActions,
  markActionProcessing,
  rowToAction,
  skipAction,
  type RequestedAction,
} from "@/lib/requestedActions";
import { uploadDocument } from "@/lib/uploads";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

type CategoryItemStatus = "done" | "doing" | "todo";

interface CategoryItem {
  id: string;
  label: string;
  status: CategoryItemStatus;
  note?: string;
}

interface Category {
  id: string;
  label: string;
  pct: number;
  items: CategoryItem[];
  // Filename substrings used to filter user_documents into per-category
  // "Documents" quick links. Hand-mapped until the agent tags uploads
  // with a category at ingest time.
  docHints: string[];
  // Form IDs from state.forms to surface as quick links. The form's
  // current fill % shows inline so the user has a one-glance read on
  // "what this category translates into on the actual return."
  formIds: string[];
}

// Static category definitions. When we add a categorization endpoint on
// the agent side these become server-derived; until then, edit the file.
const CATEGORIES: Category[] = [
  {
    id: "filing",
    label: "Filing status",
    pct: 100,
    items: [
      { id: "f1", label: "Filing status", status: "done", note: "Single" },
      { id: "f2", label: "Dependents", status: "done", note: "None for 2025" },
      { id: "f3", label: "Residency (state)", status: "done", note: "Full-year California" },
    ],
    docHints: [],
    formIds: ["1040", "540"],
  },
  {
    id: "wages",
    label: "Wages",
    pct: 100,
    items: [
      { id: "w1", label: "W-2 wages", status: "done" },
      { id: "w2", label: "Federal withholding", status: "done" },
      { id: "w3", label: "Self-employment income (1099-NEC)", status: "todo", note: "Confirm none" },
    ],
    docHints: ["w-2", "w2", "1099-nec"],
    formIds: ["1040"],
  },
  {
    id: "investments",
    label: "Investments",
    pct: 20,
    items: [
      { id: "i1", label: "Dividends (1099-DIV)", status: "doing", note: "Thom is asking now" },
      { id: "i2", label: "Interest (1099-INT)", status: "done" },
      { id: "i3", label: "Capital gains (Schedule D / 8949)", status: "todo" },
      { id: "i4", label: "Crypto disposals", status: "todo" },
      { id: "i5", label: "Other investment income (1099-MISC, royalties)", status: "todo" },
    ],
    docHints: ["1099-int", "1099-div", "1099-b", "1099-misc", "k-1", "k1"],
    formIds: ["1040", "schedule-d", "8949"],
  },
  {
    id: "deductions",
    label: "Deductions",
    pct: 0,
    items: [
      { id: "d1", label: "Standard vs itemized comparison", status: "todo", note: "Decides which path is worth pursuing" },
      { id: "d2", label: "Charitable contributions", status: "todo" },
      { id: "d3", label: "Mortgage interest (Form 1098)", status: "todo" },
      { id: "d4", label: "State and local taxes (SALT)", status: "todo" },
      { id: "d5", label: "Medical expenses (over 7.5% of AGI)", status: "todo" },
    ],
    docHints: ["1098", "donation", "charity", "receipt"],
    formIds: ["1040", "schedule-a"],
  },
];

// Pick the first not-yet-complete category as the default expanded one.
// Skews toward the in-progress one (0 < pct < 100) over not-started.
function defaultExpandedCategoryId(): string {
  const inProgress = CATEGORIES.find((c) => c.pct > 0 && c.pct < 100);
  if (inProgress) return inProgress.id;
  const incomplete = CATEGORIES.find((c) => c.pct < 100);
  return (incomplete ?? CATEGORIES[0]).id;
}

interface UploadRow {
  id: string;
  filename: string;
  created_at: string;
}

export default function HomeTab() {
  const { activeReturn, state, resetTick, turnTick } = useAppShell();
  // Default-expand the in-progress category so the user lands on a
  // populated drill-down (and never sees an empty Progress card).
  const [expandedCat, setExpandedCat] = useState<string | null>(() => defaultExpandedCategoryId());
  const [uploads, setUploads] = useState<UploadRow[]>([]);

  // Pull uploads so the per-category quick-links section can filter by
  // filename hint. Refetches on resetTick + turn so newly-attached docs
  // appear without manual refresh.
  useEffect(() => {
    if (!activeReturn.realDataAvailable) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("user_documents")
      .select("id, filename, created_at")
      .eq("category", "uploads")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("[home] failed to load uploads:", error.message);
          return;
        }
        setUploads((data ?? []) as UploadRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeReturn.realDataAvailable, resetTick, turnTick]);

  if (!activeReturn.realDataAvailable) {
    return <PlaceholderHome />;
  }

  const expanded = expandedCat ? CATEGORIES.find((c) => c.id === expandedCat) : null;
  const overallPct = state ? computeOverallPct(state.forms) : 0;
  const openCount = state ? state.pendingDecisions.length + state.pendingFacts.length : 0;

  return (
    <div className="px-6 lg:px-10 pt-4 lg:pt-6 pb-10 max-w-5xl mx-auto space-y-6">
      <section className="card p-5">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">Progress</div>
            <div className="text-2xl font-semibold tracking-tight tabular-nums text-ink-primary mt-1">
              {overallPct}% complete
            </div>
          </div>
          {state && (
            <div className="text-sm text-ink-secondary tabular-nums">
              {state.factCount} facts · {openCount} open · {state.forms.length} forms
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {CATEGORIES.map((cat) => (
            <ProgressSegment
              key={cat.id}
              label={cat.label}
              pct={cat.pct}
              active={expandedCat === cat.id}
              onClick={() => setExpandedCat(expandedCat === cat.id ? null : cat.id)}
            />
          ))}
        </div>

        {expanded && (
          <CategoryDetailsPanel
            key={expanded.id}
            category={expanded}
            uploads={uploads}
            forms={state?.forms ?? []}
            returnId={activeReturn.id}
            onCollapse={() => setExpandedCat(null)}
          />
        )}
      </section>

      {/* Plan moved into the chat pane (always-visible above the input).
          This slot is now for things Thom is asking the USER to do —
          uploads, confirmations, decisions — that don't fit a natural
          chat turn. Stubbed with one example until the agent emits
          structured action items. */}
      <RequestedActionsCard />

      <ActivityTicker refreshKey={turnTick + resetTick * 10000} />
    </div>
  );
}

function PlaceholderHome() {
  const { activeReturn } = useAppShell();
  return (
    <div className="px-6 lg:px-10 py-16 max-w-2xl mx-auto text-center">
      <div className="text-[11px] uppercase tracking-[0.22em] text-ink-muted">
        {activeReturn.label}
      </div>
      <h1 className="font-serif text-3xl text-ink-primary mt-3">
        {activeReturn.state === "filed" ? "Filed and read-only" : "Not started yet"}
      </h1>
      <p className="text-ink-secondary text-[15px] mt-3 max-w-md mx-auto leading-relaxed">
        {activeReturn.state === "filed"
          ? `This return is in the archive. ${activeReturn.outcome ? `Final outcome: ${activeReturn.outcome}.` : ""}`
          : "Real work happens on your 2025 Return for now. Switch back via the picker above to keep going."}
      </p>
    </div>
  );
}

function ProgressSegment({
  label,
  pct,
  active = false,
  onClick,
}: {
  label: string;
  pct: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left p-2 rounded-lg transition-colors",
        active ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-bg-elevated/40",
      )}
    >
      <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-500",
            pct === 100 ? "bg-emerald-400" : pct > 0 ? "bg-accent" : "bg-transparent",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        className={cn(
          "text-[11px] mt-1.5 truncate flex items-center justify-between gap-1",
          active ? "text-ink-primary" : "text-ink-muted",
        )}
      >
        <span>{label}</span>
        <span className="tabular-nums opacity-70">{pct}%</span>
      </div>
    </button>
  );
}

// Expanded drill-down panel for a category. Workflow list capped at 3
// items by default with a 'See N more' toggle — keeps the Progress card
// short enough that Requested Actions + Activity stay visible above the
// fold on a normal desktop. Resets on category change because the parent
// keys this component by category.id.
const WORKFLOWS_CAP = 3;

function CategoryDetailsPanel({
  category,
  uploads,
  forms,
  returnId,
  onCollapse,
}: {
  category: Category;
  uploads: UploadRow[];
  forms: FormSummary[];
  returnId: string;
  onCollapse: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleItems = showAll ? category.items : category.items.slice(0, WORKFLOWS_CAP);
  const hiddenCount = category.items.length - visibleItems.length;

  return (
    <div className="mt-5 pt-5 border-t border-border-subtle animate-fade-in">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">
            {category.label}
          </span>
          <span className="text-[11px] text-ink-faint">
            · {category.items.length} workflows
          </span>
        </div>
        <button
          onClick={onCollapse}
          className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink-primary transition-colors"
        >
          Collapse ↑
        </button>
      </div>

      <ul className="space-y-1">
        {visibleItems.map((item) => (
          <CategoryItemRow key={item.id} item={item} />
        ))}
      </ul>

      {category.items.length > WORKFLOWS_CAP && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1.5 ml-3 text-[11px] text-accent hover:text-accent-hover transition-colors"
        >
          {showAll ? "Show less" : `See ${hiddenCount} more`}
        </button>
      )}

      <CategoryQuickLinks
        category={category}
        uploads={uploads}
        forms={forms}
        returnId={returnId}
      />
    </div>
  );
}

// Quick-link strip under the workflows list. Two subsections (only render
// the one that has hits): "Documents" — uploads whose filename matches a
// docHint substring — and "Forms" — entries in state.forms whose formId
// is in the category's formIds list. Both navigate into the relevant tab.
function CategoryQuickLinks({
  category,
  uploads,
  forms,
  returnId,
}: {
  category: Category;
  uploads: UploadRow[];
  forms: FormSummary[];
  returnId: string;
}) {
  const matchingDocs = useMemo(() => {
    if (category.docHints.length === 0) return [];
    return uploads.filter((doc) => {
      const lower = doc.filename.toLowerCase();
      return category.docHints.some((h) => lower.includes(h));
    });
  }, [category.docHints, uploads]);

  const matchingForms = useMemo(() => {
    if (category.formIds.length === 0) return [];
    const wanted = new Set(category.formIds);
    return forms.filter((f) => wanted.has(f.formId.toLowerCase()) || wanted.has(f.formId));
  }, [category.formIds, forms]);

  if (matchingDocs.length === 0 && matchingForms.length === 0) return null;

  return (
    <div className="mt-5 pt-4 border-t border-border-subtle grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted mb-2">Documents</div>
        {matchingDocs.length === 0 ? (
          <div className="text-[12px] text-ink-muted">
            No matching uploads yet.{" "}
            <Link href={`/r/${returnId}/documents`} className="text-accent hover:text-accent-hover">
              Upload →
            </Link>
          </div>
        ) : (
          <ul className="space-y-1">
            {matchingDocs.slice(0, 4).map((doc) => (
              <li key={doc.id}>
                <a
                  href={`/documents/${doc.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[12px] text-ink-secondary hover:text-ink-primary group"
                >
                  <span className="text-ink-faint">📎</span>
                  <span className="truncate">{doc.filename}</span>
                  <span className="text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0">
                    ↗
                  </span>
                </a>
              </li>
            ))}
            {matchingDocs.length > 4 && (
              <li>
                <Link
                  href={`/r/${returnId}/documents`}
                  className="text-[11px] text-accent hover:text-accent-hover"
                >
                  +{matchingDocs.length - 4} more →
                </Link>
              </li>
            )}
          </ul>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted mb-2">Forms</div>
        {matchingForms.length === 0 ? (
          <div className="text-[12px] text-ink-muted">No forms drafted yet for this category.</div>
        ) : (
          <ul className="space-y-2">
            {matchingForms.map((f) => {
              const total = Math.max(0, f.fieldCount - f.unsupportedFieldCount);
              const filled = Math.max(0, total - f.blockedFieldCount);
              const pct = total === 0 ? 0 : Math.round((filled / total) * 100);
              return (
                <li key={f.formId}>
                  <Link
                    href={`/r/${returnId}/forms`}
                    className="block group"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] text-ink-secondary group-hover:text-ink-primary truncate">
                        {f.title}
                      </span>
                      <span className="text-[10px] text-ink-muted tabular-nums shrink-0">{pct}%</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-bg-elevated overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all duration-500",
                          pct === 100 ? "bg-emerald-400" : pct > 0 ? "bg-accent" : "bg-transparent",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function CategoryItemRow({ item }: { item: CategoryItem }) {
  const isDone = item.status === "done";
  const isDoing = item.status === "doing";
  return (
    <li>
      <button
        className={cn(
          "w-full flex items-start gap-3 p-2.5 rounded-lg text-left transition-colors group",
          !isDone && "hover:bg-bg-elevated/50",
        )}
      >
        {isDone ? (
          <svg viewBox="0 0 16 16" className="shrink-0 mt-[3px] w-3.5 h-3.5 text-emerald-400" aria-hidden>
            <circle cx="8" cy="8" r="7.5" fill="currentColor" opacity="0.18" />
            <path d="M4.5 8.2 6.8 10.5 11.5 5.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        ) : isDoing ? (
          <span className="shrink-0 mt-[5px] w-2.5 h-2.5 rounded-full bg-accent animate-pulse-soft" />
        ) : (
          <span className="shrink-0 mt-[4px] w-3 h-3 rounded-full border border-border-strong" />
        )}
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              "text-sm leading-snug",
              isDoing && "text-ink-primary font-medium",
              isDone && "text-ink-muted",
              !isDoing && !isDone && "text-ink-secondary group-hover:text-ink-primary transition-colors",
            )}
          >
            {item.label}
          </div>
          {item.note && (
            <div className="text-[11px] text-ink-muted mt-0.5 leading-snug">{item.note}</div>
          )}
        </div>
        {!isDone && (
          <span
            className={cn(
              "text-[11px] shrink-0 mt-0.5 transition-opacity",
              isDoing ? "text-accent opacity-100" : "text-accent opacity-0 group-hover:opacity-100",
            )}
          >
            {isDoing ? "In progress" : "Start →"}
          </span>
        )}
      </button>
    </li>
  );
}

// Requested Actions — things Thom needs the user to DO. Pulls live rows
// from public.requested_actions (status='open') and subscribes to realtime
// inserts/updates so a freshly-emitted request lands without a refresh.
//
// v1: only kind='upload' (document requests). Upload runs the existing
// uploadDocument() flow then marks the action resolved with the new
// document id; Skip just flips status. Both make the card disappear
// because the query filter is status='open'.
function RequestedActionsCard() {
  const { userId, thomBusy, sendChat, setMobilePane, resetTick, turnTick } = useAppShell();
  const supabase = useMemo(() => createClient(), []);
  const [actions, setActions] = useState<RequestedAction[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Re-fetch on mount, after every reset, and after every Thom turn.
  // Realtime is the primary update channel during a session (instant
  // inserts/updates without polling), but a refetch after each turn
  // catches anything realtime dropped and a refetch after reset clears
  // stale rows the wipe already removed from the DB.
  useEffect(() => {
    let cancelled = false;
    fetchOpenActions(supabase, ACTIVITY_TAX_YEAR)
      .then((rows) => {
        if (!cancelled) setActions(rows);
      })
      .catch((err) => {
        console.warn("[actions] fetch failed:", err);
        if (!cancelled) setActions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, resetTick, turnTick]);

  useEffect(() => {
    const userFilter = `user_id=eq.${userId}`;
    const channelName = `actions-${userId}-${Math.random().toString(36).slice(2, 10)}`;

    function isVisible(a: RequestedAction): boolean {
      return a.status === "open" || a.status === "processing";
    }
    function applyInsert(row: Record<string, unknown>) {
      const a = rowToAction(row);
      if (!isVisible(a)) return;
      setActions((prev) => {
        const base = prev ?? [];
        if (base.some((x) => x.id === a.id)) return base;
        return [a, ...base];
      });
    }
    function applyUpdate(row: Record<string, unknown>) {
      const a = rowToAction(row);
      setActions((prev) => {
        if (!prev) return prev;
        if (!isVisible(a)) return prev.filter((x) => x.id !== a.id);
        const idx = prev.findIndex((x) => x.id === a.id);
        if (idx === -1) return [a, ...prev];
        const next = prev.slice();
        next[idx] = a;
        return next;
      });
    }

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "requested_actions", filter: userFilter },
        (payload) => applyInsert(payload.new as Record<string, unknown>),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "requested_actions", filter: userFilter },
        (payload) => applyUpdate(payload.new as Record<string, unknown>),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  async function handleUpload(action: RequestedAction, file: File) {
    setBusyId(action.id);
    try {
      const uploaded = await uploadDocument(file);
      // Card flips to "processing" — stays visible until Thom calls
      // dismiss-requested-action after ingesting. Optimistic: the
      // realtime UPDATE will also patch it (no-op if we got here first).
      await markActionProcessing(supabase, action.id, uploaded.id);
      setActions((prev) =>
        prev ? prev.map((x) => (x.id === action.id ? { ...x, status: "processing" } : x)) : prev,
      );
      // Mobile users can't see the chat from the workspace pane; flip
      // them to it so they see Thom react to the upload.
      setMobilePane("chat");
      // Same code path the textarea uses — sendChat is the canonical
      // entry point. skipUpload=true because we already wrote to
      // user_documents above.
      await sendChat({
        text: action.documentType
          ? `Uploaded ${action.documentType} — ${file.name}`
          : `Uploaded ${file.name}`,
        file,
        skipUpload: true,
      });
    } catch (err) {
      console.warn("[actions] upload failed:", err);
    } finally {
      setBusyId(null);
    }
  }

  async function handleSkip(action: RequestedAction) {
    setBusyId(action.id);
    try {
      await skipAction(supabase, action.id);
      setActions((prev) => (prev ? prev.filter((x) => x.id !== action.id) : prev));
    } catch (err) {
      console.warn("[actions] skip failed:", err);
    } finally {
      setBusyId(null);
    }
  }

  const isEmpty = !actions || actions.length === 0;

  return (
    <section className="card">
      <div className="card-header">
        <span>Requested actions</span>
        <span className="tabular-nums text-ink-muted normal-case tracking-normal">
          {actions?.length ?? 0}
        </span>
      </div>
      {isEmpty ? (
        <div className="px-5 pb-5 pt-1 text-sm text-ink-muted leading-relaxed">
          Nothing waiting on you. Thom will drop a card here when he needs a specific document.
        </div>
      ) : (
        <div className="px-5 pb-5 space-y-2.5">
          {actions!.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              busy={busyId === a.id || thomBusy}
              onUpload={(file) => handleUpload(a, file)}
              onSkip={() => handleSkip(a)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ActionCard({
  action,
  busy,
  onUpload,
  onSkip,
}: {
  action: RequestedAction;
  busy: boolean;
  onUpload: (file: File) => void;
  onSkip: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isProcessing = action.status === "processing";
  return (
    <div className="surface px-4 py-3.5 flex items-start gap-3.5 hover:border-border-strong transition-colors">
      <div className="shrink-0 w-9 h-9 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
        {action.kind === "upload" && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        )}
        {action.kind === "confirm" && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {action.kind === "decide" && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink-primary font-medium">{action.title}</div>
        {isProcessing ? (
          <div className="text-[12px] text-amber-300/90 mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
            <span>Thom is reviewing this…</span>
          </div>
        ) : (
          action.detail && (
            <div className="text-[12px] text-ink-secondary mt-0.5 leading-relaxed">
              {action.detail}
            </div>
          )
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {action.kind === "upload" && !isProcessing && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={action.acceptPattern ?? "application/pdf,image/png,image/jpeg,image/webp"}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:bg-bg-elevated disabled:text-ink-muted text-white font-medium transition-colors"
            >
              {busy ? "Uploading…" : "Upload PDF"}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="text-xs px-2 py-1.5 text-ink-muted hover:text-ink-secondary disabled:opacity-50 transition-colors"
        >
          {isProcessing ? "Cancel" : "Skip"}
        </button>
      </div>
    </div>
  );
}

// Horizontal live-wire of recent facts + decisions. Newest on the left,
// older trailing right with a fade gradient on the right edge to signal
// "more if you scroll." Pulls from fetchActivityItems + Supabase Realtime
// so any new tax_facts INSERT or ai_decisions INSERT/UPDATE animates in
// live. Clicking a chip opens an ActivityDetail modal — handy for
// surfacing the rationale + supporting facts + verdict reason behind a
// decision, so the user can see exactly what Thom was thinking.
function ActivityTicker({ refreshKey }: { refreshKey: number }) {
  const { userId } = useAppShell();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [selected, setSelected] = useState<ActivityItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchActivityItems(supabase, 30)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        console.warn("[ticker] fetch failed:", err);
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, supabase]);

  useEffect(() => {
    const userFilter = `user_id=eq.${userId}`;

    function prepend(item: ActivityItem) {
      setItems((prev) => {
        const base = prev ?? [];
        if (base.some((existing) => existing.id === item.id)) return base;
        return [item, ...base].slice(0, 30);
      });
    }
    function patch(item: ActivityItem) {
      setItems((prev) => {
        if (!prev) return prev;
        const idx = prev.findIndex((existing) => existing.id === item.id);
        if (idx === -1) return prev;
        const next = prev.slice();
        next[idx] = item;
        return next;
      });
    }

    // Unique channel name per mount — see ActivityCard for context.
    const channelName = `ticker-${userId}-${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tax_facts", filter: userFilter }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (row.tax_year !== ACTIVITY_TAX_YEAR) return;
        prepend(factRowToItem(row));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ai_decisions", filter: userFilter }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (row.tax_year !== ACTIVITY_TAX_YEAR) return;
        prepend(decisionRowToItem(row));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ai_decisions", filter: userFilter }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (row.tax_year !== ACTIVITY_TAX_YEAR) return;
        patch(decisionRowToItem(row));
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  return (
    <section className="card">
      <div className="card-header">
        <span>Activity</span>
        <span className="tabular-nums text-ink-muted normal-case tracking-normal">
          {items?.length ?? 0} recent
        </span>
      </div>
      {items === null ? (
        <div className="px-5 pb-5 text-sm text-ink-muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-5 pb-5 text-sm text-ink-muted">
          Nothing yet. Items appear here the moment Thom records them.
        </div>
      ) : (
        <>
          <div
            className="relative px-5 pb-3"
            style={{ maskImage: "linear-gradient(to right, black 94%, transparent)" }}
          >
            <div className="flex gap-2.5 overflow-x-auto overflow-y-hidden snap-x scroll-px-5">
              {items.map((item) => (
                <ActivityChip
                  key={item.id}
                  item={item}
                  active={selected?.id === item.id}
                  onClick={() => setSelected(selected?.id === item.id ? null : item)}
                />
              ))}
            </div>
          </div>

          {selected && (
            <ActivityDetailPanel
              item={selected}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </section>
  );
}

function ActivityChip({
  item,
  active,
  onClick,
}: {
  item: ActivityItem;
  active: boolean;
  onClick: () => void;
}) {
  const isDecision = item.kind === "decision";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 w-[180px] snap-start surface p-3 flex flex-col gap-1.5 text-left",
        "transition-colors animate-fade-in",
        active
          ? "bg-accent/10 ring-1 ring-accent/30 border-accent/30"
          : "hover:border-border-strong hover:bg-bg-elevated/40",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "text-[9px] uppercase tracking-[0.18em] font-medium",
            isDecision ? "text-accent" : "text-ink-muted",
          )}
        >
          {item.kind}
        </span>
        <span className="text-[10px] text-ink-faint tabular-nums">{timeAgo(item.createdAt)}</span>
      </div>
      <div className="text-[12px] text-ink-primary leading-tight truncate" title={humanizeKey(item.title)}>
        {humanizeKey(item.title)}
      </div>
      <div className="text-[12px] text-ink-secondary leading-tight truncate" title={briefValue(item.value)}>
        {briefValue(item.value)}
      </div>
      {isDecision && item.verdict && <VerdictBadge verdict={item.verdict} />}
    </button>
  );
}

// Detail panel rendered INSIDE the Activity card, below the chip row,
// when a chip is clicked. Matches the Progress drill-down pattern —
// grows the card vertically rather than overlaying a modal.
function ActivityDetailPanel({
  item,
  onClose,
}: {
  item: ActivityItem;
  onClose: () => void;
}) {
  const isDecision = item.kind === "decision";
  return (
    <div className="px-5 pb-5 pt-4 border-t border-border-subtle animate-fade-in">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className={cn(
              "text-[10px] uppercase tracking-[0.18em] font-medium",
              isDecision ? "text-accent" : "text-ink-muted",
            )}
          >
            {item.kind}
          </span>
          <span className="font-serif text-[15px] text-ink-primary truncate">{humanizeKey(item.title)}</span>
          <span className="text-[11px] text-ink-faint tabular-nums shrink-0">{timeAgo(item.createdAt)} ago</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink-primary transition-colors shrink-0"
        >
          Collapse ↑
        </button>
      </div>

      <div className="space-y-4 text-sm">
        <DetailBlock label="Value">
          <ValueDisplay value={item.value} />
        </DetailBlock>

        {isDecision && item.verdict && (
          <DetailBlock label="Review verdict">
            <div className="flex items-center gap-2 flex-wrap">
              <VerdictBadge verdict={item.verdict} />
              {item.confidence && (
                <span className="text-[10px] text-ink-muted uppercase tracking-wide">
                  {item.confidence} confidence
                </span>
              )}
            </div>
            {item.verdictReason && (
              <p className="mt-2 text-ink-secondary leading-relaxed whitespace-pre-wrap">
                {item.verdictReason}
              </p>
            )}
          </DetailBlock>
        )}

        {isDecision && item.rationale && (
          <DetailBlock label="Why Thom decided this">
            <p className="text-ink-secondary leading-relaxed whitespace-pre-wrap">{item.rationale}</p>
          </DetailBlock>
        )}

        {isDecision && item.supportingFactKeys && item.supportingFactKeys.length > 0 && (
          <DetailBlock label="Supporting facts">
            <ul className="space-y-1">
              {item.supportingFactKeys.map((k) => (
                <li key={k} className="text-ink-secondary font-mono text-[12px] truncate">
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

        <div className="text-ink-faint text-[11px] font-mono pt-2 border-t border-border-subtle">
          {item.title}
        </div>
      </div>
    </div>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function ValueDisplay({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p className="text-ink-secondary">—</p>;
  if (typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <p className="text-ink-secondary">—</p>;
    return (
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[11px] uppercase tracking-wide text-ink-muted pt-0.5">
              {k.replace(/_/g, " ")}
            </dt>
            <dd className="text-ink-primary break-words">{briefValue(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <p className="text-ink-primary break-words">{briefValue(value)}</p>;
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const tones: Record<Verdict, string> = {
    pending: "text-ink-secondary bg-bg-elevated",
    accurate: "text-emerald-400 bg-emerald-400/10",
    inaccurate: "text-red-400 bg-red-400/10",
    ungroundable: "text-amber-400 bg-amber-400/10",
    needs_more_facts: "text-amber-400 bg-amber-400/10",
    review_failed: "text-ink-muted bg-bg-elevated",
  };
  const labels: Record<Verdict, string> = {
    pending: "Reviewing",
    accurate: "Grounded",
    inaccurate: "Conflict",
    ungroundable: "No source",
    needs_more_facts: "Needs info",
    review_failed: "Failed",
  };
  return (
    <span
      className={cn(
        "inline-block self-start mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide",
        tones[verdict],
      )}
    >
      {labels[verdict]}
    </span>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function humanizeKey(key: string): string {
  const parts = key.split(/[._]/);
  return parts
    .map((part, i) =>
      i === 0 ? part.charAt(0).toUpperCase() + part.replace(/-/g, " ").slice(1) : part.replace(/-/g, " "),
    )
    .join(" · ");
}

function briefValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length === 0 ? "—" : `${v.length} items`;
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return "—";
    const [k, val] = entries[0];
    return `${k}: ${briefValue(val)}`;
  }
  return String(v);
}
