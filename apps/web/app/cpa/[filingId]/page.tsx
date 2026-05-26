import { redirect } from "next/navigation";

// Per-filing index: Forms is the only sub-route today, so /cpa/[id] just
// redirects there. Once a second tab lands this becomes an overview page
// (or stays as a redirect, depending on what reads best).
export default async function CpaFilingIndex({
  params,
}: {
  params: Promise<{ filingId: string }>;
}) {
  const { filingId } = await params;
  redirect(`/cpa/${filingId}/forms`);
}
