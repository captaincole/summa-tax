// User profile derivation from the instance owner (name/email live on the
// owner row in app.db; see lib/localAuth.ts). These helpers keep consumers
// from re-deriving initials/first names everywhere.

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

export function deriveProfile(
  owner: { email: string | null; displayName?: string | null } | null,
): UserProfile {
  const email = owner?.email ?? null;
  const explicitName = owner?.displayName;
  const displayName =
    explicitName && explicitName.trim().length > 0
      ? explicitName.trim()
      : deriveFromEmail(email);
  const firstName = displayName.split(/\s+/)[0] ?? displayName;
  const initialsSource = displayName.split(/\s+/).filter(Boolean);
  const initials =
    initialsSource.length >= 2
      ? `${initialsSource[0][0]}${initialsSource[1][0]}`.toUpperCase()
      : (initialsSource[0]?.slice(0, 2) ?? "??").toUpperCase();
  return { displayName, firstName, initials, email };
}
