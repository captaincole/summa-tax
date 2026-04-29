import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { SideNav } from "./SideNav";
import {
  fetchState,
  resetSession,
  UnauthorizedError,
  type CaseState,
} from "@/lib/api";
import { clearPasscode, getPasscode } from "@/lib/auth";

export interface LayoutOutletContext {
  state: CaseState | null;
  refreshState: () => Promise<void>;
  // Triggered when an action (e.g. reset) should bust caches in the active route.
  resetTick: number;
}

export function Layout() {
  const navigate = useNavigate();
  const [state, setState] = useState<CaseState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetTick, setResetTick] = useState(0);

  async function refreshState() {
    try {
      setState(await fetchState());
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        clearPasscode();
        navigate("/login", { replace: true });
      }
    }
  }

  useEffect(() => {
    if (!getPasscode()) {
      navigate("/login", { replace: true });
      return;
    }
    refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onReset() {
    if (!confirm("Wipe everything and start over?")) return;
    setResetting(true);
    try {
      await resetSession();
      await refreshState();
      setResetTick((t) => t + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        clearPasscode();
        navigate("/login", { replace: true });
      }
    } finally {
      setResetting(false);
    }
  }

  const ctx: LayoutOutletContext = { state, refreshState, resetTick };

  return (
    <div className="h-screen bg-bg-base text-ink-primary flex">
      <SideNav
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        taxpayerFirstName={state?.taxpayerFirstName ?? null}
        onReset={onReset}
        resetting={resetting}
      />

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Mobile-only top bar with hamburger. Desktop uses the static rail. */}
        <header className="lg:hidden shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-ink-secondary hover:text-ink-primary p-1 -ml-1"
            aria-label="Open menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="text-ink-muted text-[10px] uppercase tracking-[0.24em]">
            Wheel of Time
          </div>
        </header>

        <main className="flex-1 min-w-0 min-h-0 flex">
          <Outlet context={ctx} />
        </main>
      </div>
    </div>
  );
}
