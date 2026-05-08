"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // Proxy will redirect to /login on the next nav, but push() is more
    // immediate and refresh() drops cached Server Component output.
    router.refresh();
    router.push("/login");
  }

  return (
    <button onClick={onClick} disabled={pending} className="btn-primary">
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
