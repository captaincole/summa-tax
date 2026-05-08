import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

// Phase 2 placeholder: prove cookie auth works end-to-end. The Proxy
// has already redirected unauthed users to /login, so reaching this page
// means we have a verified session. Layout shell + chat ports in Phase 3.
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="card px-8 py-10 w-full max-w-md text-center">
        <div className="text-ink-muted text-[10px] uppercase tracking-[0.24em]">
          Wheel of Time
        </div>
        <h1 className="mt-2 font-serif text-3xl text-ink-primary">Signed in</h1>
        <p className="mt-3 text-ink-secondary text-sm">
          Cookie auth round-trip complete. Layout + chat port in Phase 3.
        </p>
        <div className="mt-6 text-ink-primary text-sm break-all">
          {user?.email ?? "(no user)"}
        </div>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
