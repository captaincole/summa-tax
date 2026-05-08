"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. @supabase/ssr handles cookie reads/writes
// automatically (falls back to document.cookie if no custom store is wired
// up), so we don't pass a `cookies` adapter here. Sign-in writes the session
// cookie; the proxy + server client then read it on subsequent navigations.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
