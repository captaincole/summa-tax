"use client";

// CPA directory picker for the Share page.
//
// Renders a grid of every registered CPA (cpa_profiles rows passed in from
// the server component). Each card shows display_name + firm; CPAs already
// invited to this filing display an "Invited" chip and a less-emphatic
// background. Clicking a card calls /app/filings/:filingId/invite-cpa with
// the chosen userId; the agent writes both filing_invites and filing_members.
//
// Optimistic update: after a successful invite, the local invite list
// updates so the chip flips immediately without a refetch. The endpoint is
// idempotent, so clicking an already-invited CPA is harmless.

import { useState } from "react";
import {
  inviteCpa,
  type CpaDirectoryEntry,
  type FilingInviteRow,
} from "@/lib/cpa";
import { cn } from "@/lib/cn";

interface Props {
  filingId: string;
  directory: CpaDirectoryEntry[];
  initialInvites: FilingInviteRow[];
}

type Status = "idle" | "busy" | "success" | "error";

export function ShareForm({ filingId, directory, initialInvites }: Props) {
  const [invites, setInvites] = useState<FilingInviteRow[]>(initialInvites);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    status: Status;
    message?: string;
  }>({ status: "idle" });

  // Lookup keyed on userId for O(1) chip rendering.
  const invitedSet = new Set(
    invites
      .filter((i) => i.status === "accepted" || i.status === "pending")
      .map((i) => i.inviteeUserId),
  );

  async function handlePick(entry: CpaDirectoryEntry) {
    if (pendingId) return;
    setPendingId(entry.userId);
    setFeedback({ status: "busy" });
    try {
      const r = await inviteCpa(filingId, entry.userId);
      if (r.ok) {
        const nowIso = new Date().toISOString();
        setInvites((prev) => {
          const without = prev.filter((i) => i.inviteeUserId !== entry.userId);
          return [
            {
              inviteeUserId: entry.userId,
              status: "accepted" as const,
              invitedAt: nowIso,
              acceptedAt: nowIso,
              revokedAt: null,
            },
            ...without,
          ];
        });
        setFeedback({
          status: "success",
          message: `Invited ${r.invitee.displayName}. They can sign in to review this return now.`,
        });
      } else {
        setFeedback({ status: "error", message: r.message });
      }
    } catch (err) {
      setFeedback({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPendingId(null);
    }
  }

  if (directory.length === 0) {
    return (
      <div className="card px-6 py-10 text-center">
        <div className="text-ink-muted text-sm">
          No CPAs are registered on the platform yet.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {directory.map((entry) => {
          const invited = invitedSet.has(entry.userId);
          const busy = pendingId === entry.userId;
          return (
            <button
              key={entry.userId}
              type="button"
              onClick={() => handlePick(entry)}
              disabled={busy || pendingId !== null}
              className={cn(
                "card p-4 text-left transition-colors flex flex-col gap-2",
                "hover:border-border-strong disabled:cursor-wait",
                invited && "bg-emerald-400/5",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-medium text-ink-primary truncate">
                  {entry.displayName}
                </div>
                {invited && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400 shrink-0">
                    Invited
                  </span>
                )}
              </div>
              {entry.firm && (
                <div className="text-[12px] text-ink-secondary truncate">
                  {entry.firm}
                </div>
              )}
              {entry.licenseNumber && (
                <div className="text-[11px] text-ink-faint font-mono tabular-nums">
                  {entry.licenseNumber}
                </div>
              )}
              <div className="mt-2 text-[11px] text-accent">
                {busy ? "Inviting…" : invited ? "Re-send invite →" : "Invite →"}
              </div>
            </button>
          );
        })}
      </div>

      {feedback.status === "success" && feedback.message && (
        <div className="px-4 py-3 rounded-lg bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 text-sm">
          {feedback.message}
        </div>
      )}
      {feedback.status === "error" && feedback.message && (
        <div className="px-4 py-3 rounded-lg bg-red-400/10 border border-red-400/30 text-red-300 text-sm">
          {feedback.message}
        </div>
      )}
    </div>
  );
}
