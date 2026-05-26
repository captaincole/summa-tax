import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Auth gate for the entire /cpa/* tree. Mirrors (app)/layout.tsx — the
// proxy does an optimistic redirect to /login for unauthed traffic; this
// is the defense-in-depth check that also pulls a verified user.
//
// Membership (is this user actually a CPA reviewer?) is enforced one level
// deeper: the landing list shows zero filings if you have no reviewer
// memberships, and the /cpa/[filingId]/layout.tsx 404s when you don't
// have a reviewer membership on the specific filing.
export default async function CpaLayout({
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
