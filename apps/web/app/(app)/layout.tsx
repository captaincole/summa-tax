import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Auth gate. The return-scoped sub-layout at /r/[returnId]/layout.tsx
// wraps children in AppShell; the home-home at (app)/page.tsx renders
// with its own minimal top bar (no AppShell needed there).
//
// getUser() contacts the Auth server (verified call), so this is safe
// to use for authorization decisions. The proxy redirects unauthed
// users earlier — this is the defense-in-depth check.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <>{children}</>;
}
