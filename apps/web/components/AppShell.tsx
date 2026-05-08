"use client";

import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { SideNav } from "@/components/SideNav";
import {
  fetchState,
  resetSession,
  UnauthorizedError,
  type CaseState,
} from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { makeMastraClient } from "@/lib/mastraClient";
import { DEMO_THREAD_ID, THOM_AGENT_ID } from "@/lib/chatSession";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachmentName?: string;
}

interface AppShellContextValue {
  // Authenticated user's id, sourced from the layout's verified getUser() call.
  // Components that subscribe to per-user resources (Realtime channels, etc.)
  // read it from here instead of re-fetching.
  userId: string;
  state: CaseState | null;
  refreshState: () => Promise<void>;
  // Triggered when the user resets so child routes can bust caches.
  resetTick: number;
  // Lifted out of Chat so the message buffer survives route changes.
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShell(): AppShellContextValue {
  const v = useContext(AppShellContext);
  if (!v) throw new Error("useAppShell must be used inside <AppShell>");
  return v;
}

export function AppShell({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  const router = useRouter();
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
        await createClient().auth.signOut();
        router.refresh();
        router.push("/login");
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
      setMessages((current) => (current.length > 0 ? current : converted));
    } catch {
      // Thread doesn't exist yet (fresh session) or transient fetch error —
      // silently leave the buffer empty.
    }
  }

  useEffect(() => {
    refreshState();
    loadChatHistory();
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
        await createClient().auth.signOut();
        router.refresh();
        router.push("/login");
      }
    } finally {
      setResetting(false);
    }
  }

  async function onSignOut() {
    await createClient().auth.signOut();
    router.refresh();
    router.push("/login");
  }

  const ctx: AppShellContextValue = {
    userId,
    state,
    refreshState,
    resetTick,
    messages,
    setMessages,
  };

  return (
    <AppShellContext.Provider value={ctx}>
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
          <header className="lg:hidden shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-ink-secondary hover:text-ink-primary p-1 -ml-1"
              aria-label="Open menu"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div className="text-ink-muted text-[10px] uppercase tracking-[0.24em]">
              Wheel of Time
            </div>
          </header>

          <main className="flex-1 min-w-0 min-h-0 flex">{children}</main>
        </div>
      </div>
    </AppShellContext.Provider>
  );
}
