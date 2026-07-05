import { redirect } from "next/navigation";
import { getOwnerSession } from "@/lib/localAuth";
import { ownerExists } from "@/lib/localAuth";

// Auth gate. The return-scoped sub-layout at /r/[returnId]/layout.tsx
// wraps children in AppShell; the home-home at (app)/page.tsx renders
// with its own minimal top bar (no AppShell needed there).
//
// getOwnerSession() verifies the cookie HMAC against the owner row — the
// proxy only did a presence check, this is the real gate.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getOwnerSession();
  if (!session) {
    redirect((await ownerExists()) ? "/login" : "/setup");
  }

  return <>{children}</>;
}
