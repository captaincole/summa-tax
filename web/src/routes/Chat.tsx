import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { makeMastraClient } from "@/lib/mastraClient";
import {
  fetchState,
  resetSession,
  UnauthorizedError,
  type CaseState,
} from "@/lib/api";
import { clearPasscode, getPasscode } from "@/lib/auth";
import { Markdown } from "@/components/Markdown";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachmentName?: string;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // FileReader gives "data:<mime>;base64,<base64>" — strip the prefix.
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const DEMO_THREAD_ID = "demo-thread";
const DEMO_RESOURCE_ID = "demo-session";

export function Chat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [state, setState] = useState<CaseState | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initial mount: bounce to /login if no passcode, otherwise load state.
  // Single effect so we never fire an unauthed fetch in the same render where
  // we'd otherwise redirect.
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

  // Keep the message list pinned to the bottom on append.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    // Allow sending with no text if there's an attachment — the file is
    // the substance of the turn. Otherwise require text as before.
    if ((!text && !attachment) || streaming) return;

    const file = attachment;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text || (file ? `Uploaded ${file.name}` : ""),
      attachmentName: file?.name,
    };
    const assistantMsg: Message = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: "",
    };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setInput("");
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setStreaming(true);

    try {
      // If the user attached a file, send a v5 ModelMessage with content
      // blocks — both images and PDFs go through FilePart (v5's user role
      // only accepts TextPart and FilePart). Plain string for text-only.
      let payload: unknown = text;
      if (file) {
        const base64 = await readFileAsBase64(file);
        const mediaType = file.type || "application/pdf";
        payload = [
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: text || "I've attached a document — please review it.",
              },
              {
                type: "file" as const,
                data: base64,
                mediaType,
                filename: file.name,
              },
            ],
          },
        ];
      }

      const client = makeMastraClient();
      const stream = await client.getAgent("thom").stream(payload as string, {
        memory: { thread: DEMO_THREAD_ID, resource: DEMO_RESOURCE_ID },
      });

      await stream.processDataStream({
        onChunk: async (chunk) => {
          if (chunk.type === "text-delta") {
            const delta = (chunk.payload as { text: string }).text;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantMsg.id
                  ? { ...msg, content: msg.content + delta }
                  : msg,
              ),
            );
          }
        },
      });
      await refreshState();
    } catch (err) {
      const message =
        err instanceof UnauthorizedError
          ? "Session expired — please sign in again."
          : err instanceof Error
            ? err.message
            : "Something went wrong.";
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantMsg.id
            ? { ...msg, content: `[${message}]` }
            : msg,
        ),
      );
      if (err instanceof UnauthorizedError) {
        clearPasscode();
        navigate("/login", { replace: true });
      }
    } finally {
      setStreaming(false);
    }
  }

  async function onReset() {
    if (!confirm("Wipe everything and start over?")) return;
    setStreaming(true);
    try {
      await resetSession();
      setMessages([]);
      await refreshState();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        clearPasscode();
        navigate("/login", { replace: true });
      }
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="h-screen bg-bg-base text-ink-primary flex flex-col">
      <header className="shrink-0 border-b border-border-subtle px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-ink-muted text-[10px] uppercase tracking-[0.24em]">
            Wheel of Time
          </div>
          <div className="text-ink-secondary text-sm">Thom Merrilin</div>
          {state?.taxpayerFirstName && (
            <div className="text-ink-primary text-sm pl-3 border-l border-border-subtle">
              Hi, {state.taxpayerFirstName}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-muted">
          {state && (
            <span>
              {state.factCount} facts · {state.openAsks.length} open ·{" "}
              {state.progress.overallPct}%
            </span>
          )}
          {state?.draftUrl && (
            <a
              href={state.draftUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover"
            >
              Draft 1040 ↗
            </a>
          )}
          <button
            onClick={onReset}
            disabled={streaming}
            className="px-3 py-1 text-xs border border-border-subtle rounded hover:border-border-strong text-ink-secondary hover:text-ink-primary disabled:opacity-50 transition-colors"
          >
            Reset
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-ink-muted text-sm py-12">
              Say hi to start. Thom will guide you through 2025 tax intake.
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  msg.role === "user"
                    ? "max-w-[80%] bg-accent text-white px-4 py-3 rounded-2xl rounded-br-sm whitespace-pre-wrap"
                    : "max-w-[100%] text-ink-primary leading-relaxed"
                }
              >
                {msg.attachmentName && (
                  <div className={
                    msg.role === "user"
                      ? "text-xs opacity-80 mb-1.5 flex items-center gap-1.5"
                      : "text-xs text-ink-muted mb-1.5 flex items-center gap-1.5"
                  }>
                    <span>📎</span>
                    <span className="truncate">{msg.attachmentName}</span>
                  </div>
                )}
                {msg.content
                  ? msg.role === "assistant"
                    ? <Markdown>{msg.content}</Markdown>
                    : msg.content
                  : streaming && <span className="animate-pulse-soft">…</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border-subtle px-6 py-4">
        <div className="max-w-2xl mx-auto">
          {attachment && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-bg-panel border border-border-subtle rounded-lg text-sm">
              <span>📎</span>
              <span className="flex-1 truncate text-ink-primary">{attachment.name}</span>
              <span className="text-ink-muted text-xs">
                {(attachment.size / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                onClick={() => {
                  setAttachment(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="text-ink-muted hover:text-ink-primary text-lg leading-none"
                aria-label="Remove attachment"
              >
                ×
              </button>
            </div>
          )}
          <form onSubmit={sendMessage} className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              title="Attach a file"
              className="shrink-0 px-3 py-3 border border-border-subtle hover:border-border-strong rounded-lg text-ink-secondary hover:text-ink-primary disabled:opacity-50 transition-colors"
            >
              📎
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={streaming ? "Thom is thinking…" : attachment ? "Add a note (optional)…" : "Type a message"}
              disabled={streaming}
              autoFocus
              className="input-base flex-1"
            />
            <button
              type="submit"
              disabled={streaming || (!input.trim() && !attachment)}
              className="btn-primary !w-auto px-6"
            >
              Send
            </button>
          </form>
        </div>
      </footer>

    </div>
  );
}
