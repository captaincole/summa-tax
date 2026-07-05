"use client";

// CPA Forms tab — read-only mirror of the taxpayer Forms tab at
// /r/[returnId]/forms. Two data sources, same merge logic as the taxpayer
// view: engine state (from /app/cpa/filings/:id/state) + drafts (from
// user_documents via RLS, filtered to this filing).
//
// Differences from the taxpayer side:
//   - No useAppShell/AppShell context — the CPA layout doesn't provide
//     one. State is fetched directly via fetchCpaFilingState(filingId).
//   - No turn/reset ticks. The taxpayer side refetches drafts after every
//     Luca turn (turnTick) and after every reset; the CPA has no agent
//     loop driving updates, so a single fetch on mount is the right
//     default. We can add a manual refresh button later if reviewers ask.
//   - No "no data available" placeholder — by the time we're rendering,
//     the layout has already verified cpa_reviewer membership.

import { use, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { fetchCpaFilingState, type CpaFilingState } from "@/lib/cpa";
import type { FormSummary } from "@/lib/api";
import { cn } from "@/lib/cn";

interface DraftRow {
  id: string;
  filename: string;
  created_at: string;
  mime_type: string | null;
  size_bytes: number | null;
  metadata: Record<string, unknown> | null;
}

interface FormItem {
  key: string;
  label: string;
  description: string | null;
  form?: FormSummary;
  draft?: DraftRow;
}

export default function CpaFormsTab() {
  const params = useParams<{ filingId: string }>();
  const filingId = params.filingId;

  const [state, setState] = useState<CpaFilingState | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCpaFilingState(filingId)
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [filingId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/drafts?filingId=${encodeURIComponent(filingId)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as DraftRow[];
      })
      .then((rows) => {
        if (!cancelled) setDrafts(rows);
      })
      .catch((err) => {
        console.warn("[cpa-forms] drafts fetch failed:", err);
        if (!cancelled) setDrafts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [filingId]);

  const items = useMemo(
    () => mergeFormsAndDrafts(state?.forms ?? [], drafts),
    [state?.forms, drafts],
  );

  if (error) {
    return (
      <div className="px-6 lg:px-10 py-16 max-w-2xl mx-auto text-center">
        <h1 className="font-serif text-2xl text-ink-primary">Couldn't load forms</h1>
        <p className="text-ink-secondary text-sm mt-3">{error}</p>
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-10 py-8 max-w-5xl mx-auto">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <h2 className="font-serif text-2xl text-ink-primary">Tax forms</h2>
          <p className="text-ink-secondary text-sm mt-1">
            Read-only snapshot of every form the engine has computed for this return.
          </p>
        </div>
        <span className="text-[11px] text-ink-muted uppercase tracking-wider">
          {state === null ? "Loading…" : `${items.length} ${items.length === 1 ? "form" : "forms"}`}
        </span>
      </div>

      {state === null ? (
        <div className="card px-6 py-8 text-center text-ink-muted text-sm">
          Loading state from the engine…
        </div>
      ) : items.length === 0 ? (
        <div className="card px-6 py-8 text-center">
          <div className="text-ink-muted text-sm">No forms yet.</div>
          <div className="mt-1 text-ink-faint text-xs">
            They appear here as the taxpayer's facts land.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <FormRow key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function FormRow({ item }: { item: FormItem }) {
  const status = computeStatus(item);
  const fill = item.form ? computeFill(item.form) : null;
  const draftHref = item.draft ? `/documents/${item.draft.id}` : null;
  const draftDownloadHref = draftHref ? `${draftHref}?download=1` : null;

  return (
    <div className="card px-5 py-4 flex items-center gap-4">
      <div className="w-10 h-12 shrink-0 rounded bg-bg-elevated border border-border-subtle flex items-center justify-center text-ink-muted text-[10px] font-mono">
        {draftHref ? (item.draft!.mime_type?.includes("json") ? "JSON" : "PDF") : "—"}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-ink-primary truncate">{item.label}</span>
          <StatusPill status={status} />
        </div>
        {item.description && (
          <div className="mt-0.5 text-[12px] text-ink-secondary truncate">
            {item.description}
          </div>
        )}
        {fill && (status === "drafting" || status === "not_started") && (
          <div className="mt-2 flex items-center gap-2.5">
            <div className="flex-1 max-w-[180px] h-1 rounded-full bg-bg-elevated overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-500",
                  fill.pct === 100 ? "bg-emerald-400" : fill.pct > 0 ? "bg-accent" : "bg-transparent",
                )}
                style={{ width: `${fill.pct}%` }}
              />
            </div>
            <span className="text-[11px] text-ink-muted tabular-nums">
              {fill.filled} / {fill.total}
            </span>
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {draftHref ? (
          <>
            <a
              href={draftHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-ink-secondary hover:text-ink-primary border border-border-subtle hover:border-border-strong rounded-md px-3 py-1.5 transition-colors"
            >
              Open
            </a>
            <a
              href={draftDownloadHref!}
              className="text-xs text-ink-secondary hover:text-ink-primary border border-border-subtle hover:border-border-strong rounded-md px-3 py-1.5 transition-colors"
            >
              Download
            </a>
          </>
        ) : (
          <span className="text-[11px] text-ink-faint italic px-2">No PDF yet</span>
        )}
      </div>
    </div>
  );
}

type Status = "not_started" | "drafting" | "generated" | "not_filing" | "pending_decision";

function computeStatus(item: FormItem): Status {
  if (item.draft) return "generated";
  if (item.form) {
    if (!item.form.mustFile.ok) return "pending_decision";
    if (item.form.mustFile.value === false) return "not_filing";
    const filled = item.form.fieldCount - item.form.unsupportedFieldCount - item.form.blockedFieldCount;
    if (filled === 0) return "not_started";
    return "drafting";
  }
  return "generated";
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; tone: string }> = {
    not_started: { label: "Not started", tone: "bg-bg-elevated text-ink-muted" },
    drafting: { label: "Drafting", tone: "bg-accent/15 text-accent" },
    generated: { label: "Generated", tone: "bg-emerald-400/10 text-emerald-400" },
    not_filing: { label: "Not filing", tone: "bg-bg-elevated text-ink-muted" },
    pending_decision: { label: "Pending decision", tone: "bg-amber-400/10 text-amber-300" },
  };
  const { label, tone } = map[status];
  return (
    <span className={cn("px-2 py-0.5 rounded text-[10px] uppercase tracking-wide", tone)}>
      {label}
    </span>
  );
}

function computeFill(form: FormSummary): { filled: number; total: number; pct: number } {
  const total = Math.max(0, form.fieldCount - form.unsupportedFieldCount);
  const filled = Math.max(0, total - form.blockedFieldCount);
  const pct = total === 0 ? 0 : Math.round((filled / total) * 100);
  return { filled, total, pct };
}

function draftKey(draft: DraftRow): string {
  const metaFormId = draft.metadata?.formId;
  if (typeof metaFormId === "string" && metaFormId.length > 0) return metaFormId;
  const lower = draft.filename.toLowerCase();
  if (lower.includes("8949")) return "8949";
  if (lower.includes("schedule-d") || lower.includes("sched-d")) return "schedule-d";
  if (lower.includes("schedule-ca") || lower.includes("sched-ca")) return "schedule-ca";
  if (lower.includes("schedule-a") || lower.includes("sched-a")) return "schedule-a";
  if (lower.includes("1040")) return "1040";
  if (lower.includes("540")) return "540";
  if (lower.endsWith(".json") || lower.includes("sidecar") || lower.includes("forms-data")) {
    return "sidecar";
  }
  return draft.filename;
}

function formKey(form: FormSummary): string {
  return form.formId.replace(/^form-/, "");
}

const ORPHAN_LABELS: Record<string, { label: string; description: string }> = {
  "8949": { label: "Form 8949", description: "Sales and Other Dispositions of Capital Assets" },
  "schedule-d": { label: "Schedule D", description: "Capital Gains and Losses" },
  "schedule-ca": { label: "Schedule CA (540)", description: "California adjustments to federal amounts" },
  "schedule-a": { label: "Schedule A", description: "Itemized deductions" },
  sidecar: { label: "Forms data (JSON)", description: "Every computed line — useful for CPA review" },
};

function mergeFormsAndDrafts(forms: FormSummary[], drafts: DraftRow[]): FormItem[] {
  const draftByKey = new Map<string, DraftRow>();
  for (const d of drafts) {
    const key = draftKey(d);
    if (!draftByKey.has(key)) draftByKey.set(key, d);
  }

  const items: FormItem[] = [];
  const claimedKeys = new Set<string>();

  for (const f of forms) {
    const key = formKey(f);
    claimedKeys.add(key);
    items.push({
      key,
      label: f.title,
      description: null,
      form: f,
      draft: draftByKey.get(key),
    });
  }

  for (const [key, draft] of draftByKey.entries()) {
    if (claimedKeys.has(key)) continue;
    const meta = ORPHAN_LABELS[key];
    items.push({
      key,
      label: meta?.label ?? draft.filename,
      description: meta?.description ?? null,
      draft,
    });
  }

  return items;
}
