import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Server-side Supabase client. Use from Server Components, Route Handlers,
// and Server Actions. Always create a fresh client per request — never share
// across requests.
//
// `cookies()` in Next.js 16 is async (returns `Promise<ReadonlyRequestCookies>`),
// so this helper is async too. Pages, layouts, and route handlers must
// `await createClient()`.
//
// In Server Components specifically, `setAll` cannot actually mutate the
// response (Next.js disallows it outside of Route Handlers / Server Actions),
// so we wrap in try/catch. The Proxy is the source of truth for token
// refreshes — it runs on every navigation, refreshes if needed, and writes
// the new cookies back. This setAll is only the fallback path for
// Route Handlers and Server Actions which CAN write cookies.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't mutate response cookies — Proxy
            // handles refresh, so the swallow is safe here.
          }
        },
      },
    },
  );
}
