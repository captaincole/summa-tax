// Share-with-CPA page.
//
// Owner-only affordance. Resolves the active owner filing, the directory
// of registered CPAs, and the current invite roster all server-side, then
// renders the picker as a client component. The owner picks a CPA card;
// the client posts to /app/filings/:filingId/invite-cpa with the chosen
// userId; the agent writes filing_invites + filing_members.
//
// `returnId` from the route is the slug ("2025"), not a uuid — we map it
// to tax_year and resolve the filing on the server. When non-real returns
// hit this page (e.g. archived 2023), bail with a placeholder.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOwnerFilingForYear } from "@/lib/filings";
import { getReturnById } from "@/lib/returns";
import { listCpaDirectory, listFilingInvites } from "@/lib/cpa";
import { ShareForm } from "./ShareForm";

export default async function SharePage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  const { returnId } = await params;
  const activeReturn = getReturnById(returnId);

  if (!activeReturn || !activeReturn.realDataAvailable) {
    return (
      <div className="px-6 lg:px-10 py-16 max-w-2xl mx-auto text-center">
        <h1 className="font-serif text-2xl text-ink-primary">
          Sharing isn't available for this return
        </h1>
        <p className="text-ink-secondary text-sm mt-3">
          Switch to your active 2025 return to invite a reviewer.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const filing = await getOwnerFilingForYear(supabase, activeReturn.year);
  const [directory, invites] = await Promise.all([
    listCpaDirectory(supabase),
    listFilingInvites(supabase, filing.id),
  ]);

  return (
    <div className="px-6 lg:px-10 py-8 max-w-3xl mx-auto">
      <header className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-ink-muted">
          Tax Year {filing.taxYear}
        </div>
        <h1 className="font-serif text-3xl text-ink-primary mt-2">
          Share with a CPA
        </h1>
        <p className="text-ink-secondary text-[15px] mt-3 leading-relaxed">
          Pick a registered CPA to invite. They'll see everything you've shared with Thom — facts, decisions, draft forms — in a read-only view. They can't edit, chat, or take actions on your behalf.
        </p>
      </header>

      <ShareForm
        filingId={filing.id}
        directory={directory}
        initialInvites={invites}
      />

      <div className="mt-8 text-[12px] text-ink-faint leading-relaxed">
        <p>
          <Link
            href={`/r/${activeReturn.id}`}
            className="text-ink-secondary hover:text-ink-primary transition-colors"
          >
            ← Back to your return
          </Link>
        </p>
      </div>
    </div>
  );
}
