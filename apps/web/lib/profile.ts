import type { User } from "@supabase/supabase-js";

// User profile derivation. We don't have a user_profiles table — display
// name lives on auth.users.raw_user_meta_data (set at signup or via
// supabase.auth.admin.updateUserById). Pulling it through these helpers
// keeps consumers from poking at user_metadata shapes directly.

export interface UserProfile {
  // Friendly display name. Either the explicit `display_name` from auth
  // metadata, or a fallback derived from the email's local-part.
  displayName: string;
  // First word of the display name — what the greeting renders.
  firstName: string;
  // Two-letter avatar tag.
  initials: string;
  email: string | null;
}

function deriveFromEmail(email: string | null): string {
  if (!email) return "there";
  const local = email.split("@")[0] ?? "";
  if (!local) return "there";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function deriveProfile(user: User | null): UserProfile {
  const email = user?.email ?? null;
  const metadataName = (user?.user_metadata as { display_name?: string } | null)
    ?.display_name;
  const displayName =
    metadataName && metadataName.trim().length > 0
      ? metadataName.trim()
      : deriveFromEmail(email);
  const firstName = displayName.split(/\s+/)[0] ?? displayName;
  const initialsSource = displayName.split(/\s+/).filter(Boolean);
  const initials =
    initialsSource.length >= 2
      ? `${initialsSource[0][0]}${initialsSource[1][0]}`.toUpperCase()
      : (initialsSource[0]?.slice(0, 2) ?? "??").toUpperCase();
  return { displayName, firstName, initials, email };
}
