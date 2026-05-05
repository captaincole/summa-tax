import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { SideNav } from "./SideNav";
import {
  fetchState,
  resetSession,
  UnauthorizedError,
  type CaseState,
} from "@/lib/api";
import { signOut } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { makeMastraClient } from "@/lib/mastraClient";
import { DEMO_THREAD_ID, THOM_AGENT_ID } from "@/lib/chatSession";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachmentName?: string;
}

export interface LayoutOutletContext {
  state: CaseState | null;
  refreshState: () => Promise<void>;
  // Triggered when an action (e.g. reset) should bust caches in the active route.
  resetTick: number;
  // Lifted out of Chat so the message buffer survives route changes — without
  // this, navigating to /documents and back wipes the visible history even
  // though Mastra still has it in memory.
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

export function Layout() {
  const navigate = useNavigate();
  const [state, setState] = useState<CaseState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  async function refreshState() {
    try {
      setState(await fetchState());
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        await signOut();
        navigate("/login", { replace: true });
      }
    }
  }

  // Rehydrate the chat buffer from Mastra memory on full page load. Without
  // this, refreshing wipes the visible history even though the agent still
  // has the full thread server-side.
  async function loadChatHistory() {
    try {
      const client = await makeMastraClient();
      const thread = client.getMemoryThread({
        threadId: DEMO_THREAD_ID,
        agentId: THOM_AGENT_ID,
      });
      const res = await thread.listMessages({ perPage: 200 });
      const converted: ChatMessage[] = [];
      for (const m of res.messages) {
        if (m.role !== "user" && m.role !== "assistant") continue;
        const parts = m.content?.parts ?? [];
        const text = parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");
        const attachmentName =
          m.content?.experimental_attachments?.[0]?.name ?? undefined;
        if (!text && !attachmentName) continue;
        converted.push({
          id: m.id,
          role: m.role,
          content: text || (attachmentName ? `Uploaded ${attachmentName}` : ""),
          attachmentName,
        });
      }
      // If the user already started typing/sending before history loaded,
      // don't clobber their in-flight messages.
      setMessages((current) => (current.length > 0 ? current : converted));
    } catch {
      // Thread doesn't exist yet (fresh session) or transient fetch error —
      // silently leave the buffer empty.
    }
  }

  useEffect(() => {
    // Initial session check + listener for sign-out / token expiry. The
    // listener catches refresh failures and explicit signOut() calls
    // elsewhere, redirecting to /login from a single place.
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        navigate("/login", { replace: true });
        return;
      }
      refreshState();
      loadChatHistory();
    })();

    // Only redirect on actual sign-outs / failed refreshes — supabase-js fires
    // INITIAL_SESSION on subscribe with whatever's in storage, which can race
    // with a fresh sign-in's storage write and falsely appear as null. The
    // async getSession() check above is the source of truth for mount-time
    // auth state; this listener handles transitions during a live session.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") navigate("/login", { replace: true });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onReset() {
    if (!confirm("Wipe everything and start over?")) return;
    setResetting(true);
    try {
      await resetSession();
      await refreshState();
      setMessages([]);
      setResetTick((t) => t + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        await signOut();
        navigate("/login", { replace: true });
      }
    } finally {
      setResetting(false);
    }
  }

  async function onSignOut() {
    // signOut() fires SIGNED_OUT on supabase-js, which the onAuthStateChange
    // listener above catches and redirects to /login. We still navigate
    // explicitly here so the redirect is instant rather than waiting for the
    // event to dispatch.
    await signOut();
    navigate("/login", { replace: true });
  }

  const ctx: LayoutOutletContext = {
    state,
    refreshState,
    resetTick,
    messages,
    setMessages,
  };

  return (
    <div className="h-screen bg-bg-base text-ink-primary flex">
      <SideNav
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        taxpayerFirstName={state?.taxpayerFirstName ?? null}
        onReset={onReset}
        resetting={resetting}
        onSignOut={onSignOut}
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
