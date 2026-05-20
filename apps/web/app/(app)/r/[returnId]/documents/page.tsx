"use client";

// Documents tab — uploads only. Generated drafts (1040, 540, sidecar)
// live on the Forms tab as "Deliverables" per Andrew's labeling rule
// (inputs vs outputs are different concerns).
//
// Drop zone wraps the existing uploadDocument flow. Card list reads
// directly from Supabase via the per-user RLS-scoped client.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";
import { uploadDocument } from "@/lib/uploads";
import { cn } from "@/lib/cn";

interface UploadRow {
  id: string;
  filename: string;
  created_at: string;
  mime_type: string | null;
  size_bytes: number | null;
}

export default function DocumentsTab() {
  const { activeReturn, resetTick, thomBusy } = useAppShell();
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadUploads = useCallback(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("user_documents")
      .select("id, filename, created_at, mime_type, size_bytes")
      .eq("category", "uploads")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("[documents] failed to load uploads:", error.message);
          setUploads([]);
          return;
        }
        setUploads((data ?? []) as UploadRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeReturn.realDataAvailable) return;
    return loadUploads();
  }, [resetTick, activeReturn.realDataAvailable, loadUploads]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadDocument(file);
      }
      loadUploads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!activeReturn.realDataAvailable) {
    return (
      <div className="px-6 lg:px-10 py-16 max-w-2xl mx-auto text-center">
        <div className="text-[11px] uppercase tracking-[0.22em] text-ink-muted">
          {activeReturn.label}
        </div>
        <h1 className="font-serif text-3xl text-ink-primary mt-3">No documents yet</h1>
        <p className="text-ink-secondary text-[15px] mt-3 max-w-md mx-auto leading-relaxed">
          Documents you upload appear here. Switch to your 2025 Return to add files.
        </p>
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-10 py-8 max-w-5xl mx-auto">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h2 className="font-serif text-2xl text-ink-primary">Documents</h2>
          <p className="text-ink-secondary text-sm mt-1">W-2s, 1099s, K-1s — anything you've uploaded.</p>
        </div>
        <span className="text-[11px] text-ink-muted uppercase tracking-wider">
          {uploads.length} {uploads.length === 1 ? "file" : "files"}
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!thomBusy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!thomBusy) handleFiles(e.dataTransfer.files);
        }}
        disabled={uploading || thomBusy}
        className={cn(
          "w-full border-2 border-dashed rounded-2xl py-10 px-6 text-center transition-colors cursor-pointer",
          dragOver
            ? "border-accent/60 bg-accent/5"
            : "border-border-subtle hover:border-accent/40 bg-bg-subtle/40",
          (uploading || thomBusy) && "opacity-60 cursor-not-allowed",
        )}
      >
        <div className="text-3xl text-ink-muted">⬆</div>
        <div className="mt-2 text-sm text-ink-primary">
          {thomBusy
            ? "Wait for Thom to finish before uploading"
            : uploading
              ? "Uploading…"
              : "Drop W-2s, 1099s, or other tax documents here"}
        </div>
        <div className="text-xs text-ink-muted mt-1">PDF, PNG, JPG · up to 10 MB each</div>
        {!thomBusy && (
          <div className="mt-4 text-xs text-accent hover:text-accent-hover">or browse files</div>
        )}
      </button>

      {error && (
        <div className="mt-3 px-4 py-2.5 rounded-lg bg-red-400/10 border border-red-400/30 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
        {uploads.length === 0 && !uploading && (
          <div className="col-span-full card px-6 py-8 text-center">
            <div className="text-ink-muted text-sm">No uploads yet.</div>
            <div className="mt-1 text-ink-faint text-xs">
              Drop a W-2, 1099, or receipt above — or attach one in chat.
            </div>
          </div>
        )}
        {uploads.map((doc) => (
          <DocCard key={doc.id} doc={doc} />
        ))}
      </div>
    </div>
  );
}

function DocCard({ doc }: { doc: UploadRow }) {
  const href = `/documents/${doc.id}`;
  const downloadHref = `${href}?download=1`;
  return (
    <div className="card p-4 flex flex-col gap-3 group hover:border-border-strong transition-colors">
      <div className="flex items-start justify-between">
        <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wide bg-bg-elevated text-ink-secondary">
          {inferType(doc)}
        </span>
        <span className="text-[10px] text-ink-faint tabular-nums">{formatBytes(doc.size_bytes)}</span>
      </div>
      <div className="aspect-[3/4] rounded-lg bg-bg-elevated/50 border border-border-subtle flex items-center justify-center">
        <span className="text-ink-faint text-xs font-mono">PDF</span>
      </div>
      <div className="min-w-0">
        <div className="text-sm text-ink-primary truncate">{doc.filename}</div>
        <div className="text-[11px] text-ink-muted mt-0.5">{formatUploadedAt(doc.created_at)}</div>
      </div>
      <div className="flex gap-2">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-xs py-1.5 rounded border border-border-subtle hover:border-border-strong text-ink-secondary hover:text-ink-primary text-center transition-colors"
        >
          Preview
        </a>
        <a
          href={downloadHref}
          className="flex-1 text-xs py-1.5 rounded border border-border-subtle hover:border-border-strong text-ink-secondary hover:text-ink-primary text-center transition-colors"
        >
          Download
        </a>
      </div>
    </div>
  );
}

function inferType(doc: UploadRow): string {
  const name = doc.filename.toLowerCase();
  if (name.includes("w-2") || name.includes("w2")) return "W-2";
  if (name.includes("1099-int")) return "1099-INT";
  if (name.includes("1099-div")) return "1099-DIV";
  if (name.includes("1099-misc")) return "1099-MISC";
  if (name.includes("1099-nec")) return "1099-NEC";
  if (name.includes("1099")) return "1099";
  if (name.includes("k-1") || name.includes("k1")) return "K-1";
  if (name.includes("1098")) return "1098";
  return "Doc";
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}
