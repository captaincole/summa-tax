// Top bar variant for the home-home page (no active return).
// Brand logo + page title + avatar tag. The avatar derives its initials
// from the user's display name (or email fallback) via deriveProfile.

import Link from "next/link";

export function HomeTopBar({ initials }: { initials: string }) {
  return (
    <header className="shrink-0 h-14 border-b border-border-subtle bg-bg-base/95 backdrop-blur-sm flex items-center px-4 lg:px-6 gap-3">
      <Link
        href="/"
        title="Home"
        className="shrink-0 w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center hover:bg-accent/25 transition-colors"
      >
        <span className="font-serif text-accent text-sm leading-none">W</span>
      </Link>
      <div className="h-6 w-px bg-border-subtle shrink-0" />
      <span className="text-[15px] font-semibold tracking-tight text-ink-primary">Home</span>
      <div className="flex-1" />
      <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-xs font-medium text-accent">
        {initials}
      </div>
    </header>
  );
}
