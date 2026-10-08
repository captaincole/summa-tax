"use client";

// Top bar for the return-scoped layout. Renders above the chat + workspace
// split pane. Source of truth for "where am I" — chat header and workspace
// headers DO NOT re-announce the active return per the labeling rule.
//
// Structure:
//   [W → /]  [Return picker ▾]  ·  Home  Forms  Documents      [progress] [⚙] [AC]
//
// The return picker is the title-weight element (font-semibold sans —
// Fraunces renders numerals with cursive stylistic features that read
// oddly on years like "2025"). Workspace tabs are subordinate.

import { signOut } from "@/lib/auth";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { useAppShell } from "@/components/AppShell";
import { type TaxReturn } from "@/lib/returns";
import { deleteFiling, UnauthorizedError } from "@/lib/api";
import { cn } from "@/lib/cn";

interface TopBarProps {
  activeReturn: TaxReturn;
  returns: TaxReturn[];
}

const TABS = [
  { id: "home", label: "Home", path: "" },
  { id: "forms", label: "Forms", path: "/forms" },
  { id: "documents", label: "Documents", path: "/documents" },
] as const;

export function TopBar({ activeReturn, returns }: TopBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { state, profile, lucaBusy, onSignOut } = useAppShell();
  const [returnMenuOpen, setReturnMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;
    if (
      !confirm(
        `Delete your ${activeReturn.year} filing? This wipes all facts, decisions, and uploaded documents. You can start a new ${activeReturn.year} filing from the home page afterwards.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await deleteFiling(activeReturn.filingId);
      setAccountMenuOpen(false);
      router.push("/");
      router.refresh();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        await signOut();
        router.push("/login");
        return;
      }
      alert(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  const basePath = `/r/${activeReturn.id}`;
  // TODO: replace with a real overall-progress signal once the agent
  // exposes one. computeOverallPct (forms-complete fraction) reads as 0
  // until the very last form lands — fakes "no progress" even when the
  // user has been chatting for a while. For now, scale with fact count
  // so the chip feels alive at zero and tops out near completion.
  const pct = state ? Math.min(95, Math.max(8, state.factCount * 4)) : 8;

  function isTabActive(tabPath: string): boolean {
    if (tabPath === "") return pathname === basePath;
    return pathname === `${basePath}${tabPath}` || pathname.startsWith(`${basePath}${tabPath}/`);
  }

  function pickReturn(r: TaxReturn) {
    setReturnMenuOpen(false);
    router.push(`/r/${r.id}`);
  }

  return (
    <header className="shrink-0 h-14 border-b border-border-subtle bg-bg-base/95 backdrop-blur-sm flex items-center px-4 lg:px-6 gap-3 relative z-30">
      {/* Brand → home-home */}
      <Link
        href="/"
        title="All returns"
        className="shrink-0 w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center hover:bg-accent/25 transition-colors"
      >
        <span className="font-serif text-accent text-sm leading-none">W</span>
      </Link>

      <div className="h-6 w-px bg-border-subtle shrink-0" />

      {/* Active return — primary "where am I" cue */}
      <div className="relative shrink-0">
        <button
          onClick={() => setReturnMenuOpen((v) => !v)}
          className="flex items-baseline gap-1.5 px-2 -mx-2 py-1 rounded-md hover:bg-bg-elevated transition-colors"
        >
          <span className="text-[15px] font-semibold tracking-tight text-ink-primary leading-none">
            {activeReturn.label}
          </span>
          <span className="text-ink-muted text-[11px] leading-none">▾</span>
        </button>
        {returnMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setReturnMenuOpen(false)} />
            <div className="absolute top-full left-0 mt-2 w-64 bg-bg-elevated border border-border-subtle rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-40">
              <Link
                href="/"
                className="flex items-center gap-2 px-4 py-2.5 text-sm text-ink-secondary hover:text-ink-primary hover:bg-bg-panel transition-colors border-b border-border-subtle"
                onClick={() => setReturnMenuOpen(false)}
              >
                <span className="text-ink-muted">←</span>
                All returns
              </Link>
              {returns.map((r) => (
                <button
                  key={r.filingId}
                  onClick={() => pickReturn(r)}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 px-4 py-3 text-left",
                    "hover:bg-bg-panel transition-colors",
                    r.id === activeReturn.id && "bg-bg-panel",
                  )}
                >
                  <div>
                    <div className="text-sm text-ink-primary">{r.label}</div>
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      {r.state === "active" ? "In progress" : "Filed"}
                    </div>
                  </div>
                  {r.id === activeReturn.id && (
                    <span className="text-accent text-sm">✓</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Workspace tabs — subordinate to the return picker */}
      <div className="hidden md:block text-ink-faint shrink-0 px-1">·</div>
      <nav className="hidden md:flex items-center gap-0.5 flex-1 min-w-0">
        {TABS.map((t) => {
          const active = isTabActive(t.path);
          return (
            <Link
              key={t.id}
              href={`${basePath}${t.path}`}
              className={cn(
                "px-2.5 py-1 text-[13px] rounded-md transition-colors",
                active
                  ? "text-ink-primary bg-bg-elevated"
                  : "text-ink-secondary hover:text-ink-primary hover:bg-bg-elevated/50",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="md:hidden flex-1" />

      {/* Right cluster */}
      <div className="flex items-center gap-2 shrink-0">
        {lucaBusy && (
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/30 text-xs text-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
            <span>Luca is working</span>
          </div>
        )}
        {state && activeReturn.realDataAvailable && !lucaBusy && (
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-panel border border-border-subtle text-xs">
            <div className="w-16 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
              <div className="h-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular-nums text-ink-secondary">{pct}%</span>
          </div>
        )}

        <div className="relative">
          <button
            onClick={() => setAccountMenuOpen((v) => !v)}
            className="w-8 h-8 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-xs font-medium text-accent hover:bg-accent/30 transition-colors"
            title="Account"
          >
            {profile.initials}
          </button>
          {accountMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setAccountMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-2 w-56 bg-bg-elevated border border-border-subtle rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-40">
                {profile.email && (
                  <div className="px-4 py-3 border-b border-border-subtle">
                    <div className="text-[11px] uppercase tracking-wider text-ink-muted">Signed in as</div>
                    <div className="text-sm text-ink-primary truncate mt-0.5">{profile.email}</div>
                  </div>
                )}
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-300 hover:text-red-200 hover:bg-bg-panel transition-colors disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : `Delete this filing`}
                </button>
                <button
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onSignOut();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-ink-secondary hover:text-ink-primary hover:bg-bg-panel transition-colors border-t border-border-subtle"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
