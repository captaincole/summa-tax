"use client";

// The conversation surface. Lives in AppShell's left 1/3 on desktop, full
// width inside the mobile "Chat" tab. No header — identity reads from the
// avatar on each assistant message plus the Thom badge inside the input.
//
// All actual sending is delegated to AppShell.sendChat — both the form
// submit here and the Requested Actions card upload call the same
// function, so there's exactly one code path that writes user turns.

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { type ChatMessage, useAppShell } from "@/components/AppShell";
import { type TaxReturn } from "@/lib/returns";
import { type PlanItem } from "@/lib/api";
import { cn } from "@/lib/cn";

interface ChatPaneProps {
  activeReturn: TaxReturn;
}

export function ChatPane({ activeReturn }: ChatPaneProps) {
  const { messages, state, thomBusy, sendChat } = useAppShell();
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  const isPlaceholder = !activeReturn.realDataAvailable;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // sendChat disables the textarea via thomBusy — restore focus when it
  // flips back so the user can keep typing without clicking back in.
  useEffect(() => {
    if (!thomBusy && !isPlaceholder) messageInputRef.current?.focus();
  }, [thomBusy, isPlaceholder]);

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (isPlaceholder || thomBusy) return;
    const text = input.trim();
    const file = attachment;
    if (!text && !file) return;

    // Clear local input state immediately so the user sees their message
    // commit; sendChat handles the rest.
    setInput("");
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    await sendChat({ text, file: file ?? undefined });
  }

  // For placeholder returns we render a single hardcoded Thom turn instead
  // of the real message buffer — keeps the multi-return UX honest without
  // requiring backend support for non-2025 threads yet.
  const renderMessages: ChatMessage[] = isPlaceholder
    ? [placeholderMessageFor(activeReturn)]
    : messages;
  const isEmpty = renderMessages.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 pt-6 pb-3 space-y-5">
        {isEmpty && (
          <div className="flex gap-2.5 items-start text-ink-muted text-sm">
            <ThomAvatar />
            <div className="pt-0.5">Say hi to start.</div>
          </div>
        )}
        {renderMessages.map((msg) => (
          <div
            key={msg.id}
            className={msg.role === "user" ? "flex justify-end" : "flex gap-2.5 items-start"}
          >
            {msg.role === "assistant" && <ThomAvatar />}
            <div
              className={cn(
                msg.role === "user"
                  ? "max-w-[80%] bg-accent text-white px-3.5 py-2.5 rounded-2xl rounded-br-sm whitespace-pre-wrap text-[14px] leading-relaxed"
                  : "max-w-full text-ink-primary text-[14px] leading-relaxed pt-0.5",
              )}
            >
              {msg.attachmentName && (
                <div
                  className={
                    msg.role === "user"
                      ? "text-xs opacity-80 mb-1.5 flex items-center gap-1.5"
                      : "text-xs text-ink-muted mb-1.5 flex items-center gap-1.5"
                  }
                >
                  <span>📎</span>
                  <span className="truncate">{msg.attachmentName}</span>
                </div>
              )}
              {msg.content ? (
                msg.role === "assistant" ? (
                  <Markdown>{msg.content}</Markdown>
                ) : (
                  msg.content
                )
              ) : (
                thomBusy && <TypingDots />
              )}
            </div>
          </div>
        ))}
      </div>

      <footer className="shrink-0 px-3.5 pb-3.5">
        {attachment && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-bg-panel border border-border-subtle rounded-lg text-sm">
            <span>📎</span>
            <span className="flex-1 truncate text-ink-primary">{attachment.name}</span>
            <span className="text-ink-muted text-xs tabular-nums">
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

        <form
          onSubmit={onSubmit}
          className={cn(
            "rounded-2xl border border-border-subtle bg-bg-panel transition-colors",
            "focus-within:border-border-strong",
            isPlaceholder && "opacity-60",
          )}
        >
          <PlanRail plan={state?.plan ?? []} hidden={isPlaceholder} />

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <textarea
            ref={messageInputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            rows={2}
            placeholder={
              isPlaceholder
                ? "This return is a placeholder."
                : thomBusy
                  ? "Thom is thinking…"
                  : attachment
                    ? "Add a note (optional)…"
                    : "Reply to Thom…"
            }
            disabled={thomBusy || isPlaceholder}
            autoFocus={!isPlaceholder}
            className="w-full px-4 pt-3.5 pb-1 bg-transparent text-ink-primary placeholder:text-ink-muted text-[14px] leading-relaxed resize-none focus:outline-none disabled:cursor-not-allowed"
          />
          <div className="flex items-center gap-1 px-2.5 pb-2.5">
            <IconButton
              title="Attach a document"
              onClick={() => fileInputRef.current?.click()}
              disabled={thomBusy || isPlaceholder}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </IconButton>
            <IconButton title="Suggest what to ask next" disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
                <path d="M19 4l.5 1.5L21 6l-1.5.5L19 8l-.5-1.5L17 6l1.5-.5z" />
              </svg>
            </IconButton>

            <div className="flex-1" />

            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] text-ink-secondary">
              <span className="w-4 h-4 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center">
                <span className="font-serif text-accent text-[9px] leading-none">T</span>
              </span>
              <span>Thom</span>
            </div>

            <button
              type="submit"
              disabled={thomBusy || isPlaceholder || (!input.trim() && !attachment)}
              title="Send"
              className="w-8 h-8 rounded-full bg-accent hover:bg-accent-hover disabled:bg-bg-elevated disabled:text-ink-muted text-white flex items-center justify-center transition-colors ml-1"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
}

// Compact plan strip rendered INSIDE the input card. Hides done items
// entirely; caps visible at 3 with a See N more toggle.
function PlanRail({ plan, hidden }: { plan: PlanItem[]; hidden: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const active = plan.filter((p) => p.status !== "done");
  if (hidden || active.length === 0) return null;

  const CAP = 3;
  const visible = showAll ? active : active.slice(0, CAP);
  const hiddenCount = active.length - visible.length;

  return (
    <div className="px-4 pt-3 pb-2.5 border-b border-border-subtle">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">Plan</span>
        <span className="text-[10px] text-ink-muted tabular-nums">{active.length} active</span>
      </div>
      <ul className="space-y-1.5">
        {visible.map((item) => (
          <PlanRailRow key={item.id} item={item} />
        ))}
      </ul>
      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1.5 text-[11px] text-accent hover:text-accent-hover"
        >
          See {hiddenCount} more
        </button>
      )}
      {showAll && active.length > CAP && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-1.5 text-[11px] text-ink-muted hover:text-ink-secondary"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function PlanRailRow({ item }: { item: PlanItem }) {
  const isDoing = item.status === "doing";
  return (
    <li className="flex items-start gap-2">
      {isDoing ? (
        <span className="shrink-0 mt-[5px] w-2 h-2 rounded-full bg-accent animate-pulse-soft" />
      ) : (
        <span className="shrink-0 mt-[4px] w-2.5 h-2.5 rounded-full border border-border-strong" />
      )}
      <span
        className={cn(
          "text-[12px] leading-snug truncate",
          isDoing ? "text-ink-primary" : "text-ink-secondary",
        )}
      >
        {item.title}
      </span>
    </li>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-pulse-soft" />
      <span
        className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-pulse-soft"
        style={{ animationDelay: "0.2s" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-pulse-soft"
        style={{ animationDelay: "0.4s" }}
      />
    </span>
  );
}

function ThomAvatar() {
  return (
    <div className="shrink-0 w-7 h-7 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center mt-0.5">
      <span className="font-serif text-accent text-[11px] leading-none">T</span>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="w-8 h-8 rounded-lg text-ink-secondary hover:text-ink-primary hover:bg-bg-elevated flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function placeholderMessageFor(ret: TaxReturn): ChatMessage {
  // Unreachable today — the return-layout redirects to '/' when the caller
  // doesn't own a filing for the requested year, so every TaxReturn that
  // reaches ChatPane is realDataAvailable=true. Kept as a defense-in-depth
  // fallback (drift between RLS and the layout would otherwise crash here).
  if (ret.state === "filed") {
    return {
      id: "placeholder",
      role: "assistant",
      content: `This is your filed ${ret.year} return — read-only for now.`,
    };
  }
  return {
    id: "placeholder",
    role: "assistant",
    content: `Placeholder for ${ret.label}.`,
  };
}
