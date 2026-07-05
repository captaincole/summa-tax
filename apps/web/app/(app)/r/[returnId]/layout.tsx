import { redirect } from "next/navigation";
import { getOwnerSession } from "@/lib/localAuth";
import { AppShell } from "@/components/AppShell";
import { listOwnerReturns } from "@/lib/serverDb";
import { deriveProfile } from "@/lib/profile";

// Return-scoped layout. Resolves the route param against the caller's real
// owner filings (queried from the filings + filing_members tables). If the
// caller doesn't own a filing for the requested year, redirect to '/' so
// they can start one — the home-home page renders the empty-state CTA.
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
  const year = Number.parseInt(returnId, 10);
  if (!Number.isInteger(year)) redirect("/");

  const session = await getOwnerSession();
  if (!session) redirect("/login");

  const returns = await listOwnerReturns(session.userId);
  const activeReturn = returns.find((r) => r.year === year);
  if (!activeReturn) redirect("/");

  const profile = deriveProfile(session);

  return (
    <AppShell
      userId={session.userId}
      activeReturn={activeReturn}
      returns={returns}
      profile={profile}
    >
      {children}
    </AppShell>
  );
}
