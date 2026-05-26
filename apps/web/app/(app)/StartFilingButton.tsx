"use client";

// Client-side "Start a new filing" trigger. Posts to /app/filings via the
// agent (the endpoint is idempotent — re-clicks return the existing filing
// rather than 500ing), then navigates to /r/<year>. Error state lands
// inline below the button rather than disappearing into a console warn.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFiling, UnauthorizedError } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

export function StartFilingButton({
  taxYear,
  className,
  children,
}: {
  taxYear: number;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { filing } = await createFiling(taxYear);
      router.push(`/r/${filing.taxYear}`);
      router.refresh();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        await createClient().auth.signOut();
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={className}
      >
        {busy ? "Starting…" : children}
      </button>
      {error && (
        <div className="text-[12px] text-red-400">{error}</div>
      )}
    </div>
  );
}
