import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { getReturnById } from "@/lib/returns";

// Return-scoped layout. Validates the route param against the hardcoded
// RETURNS list and wraps children in AppShell (chat + workspace).
//
// The outer (app)/layout.tsx already gates auth, but we re-check getUser
// here to pull the verified userId for AppShell. Server-side: a single
// extra DB roundtrip per navigation, acceptable for now.
export default async function ReturnLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ returnId: string }>;
}) {
  const { returnId } = await params;
  const activeReturn = getReturnById(returnId);
  if (!activeReturn) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell userId={user.id} activeReturn={activeReturn}>
      {children}
    </AppShell>
  );
}
