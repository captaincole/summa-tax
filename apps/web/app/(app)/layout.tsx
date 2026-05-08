import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";

// Defense in depth: the proxy already redirects unauthed users to /login,
// but if anyone bypasses or misconfigures it, this server-side check is the
// hard gate. getUser() contacts the Auth server (verified call), so this is
// safe to use for authorization decisions.
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

  return <AppShell userId={user.id}>{children}</AppShell>;
}
