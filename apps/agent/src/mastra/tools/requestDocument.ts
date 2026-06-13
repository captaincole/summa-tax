import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { requireUserContext } from "./userContext";

// request-document-upload: surface a structured "Luca needs you to upload X"
// card on the user's dashboard. Use this when a specific tax document is
// load-bearing for the return and the user hasn't already uploaded it.
//
// Don't reach for this for things you can capture in conversation — a yes/no
// scoping question, a confirmation, a verbal value. Those still go through
// the chat. This tool is the structured escalation for "I literally need
// this PDF to fill these lines."

export const requestDocumentUpload = createTool({
  id: "request-document-upload",
  description:
    "Surface a structured document-upload request to the user as a card on their dashboard. Use ONLY when you need a specific tax document (W-2, 1099, K-1, 1098, etc.) and can't proceed without it — never for facts you can ask conversationally. Call once per document needed; don't repeat on subsequent turns. Returns the action id.",
  inputSchema: z.object({
    year: z.number().int().describe("Tax year the document is for (e.g. 2025)."),
    documentType: z
      .string()
      .describe(
        "Short canonical name of the document, e.g. 'W-2', '1099-DIV', '1099-INT', 'K-1', '1098'. Don't include the year here.",
      ),
    title: z
      .string()
      .describe(
        "User-facing card title in plain English. Be specific — include the issuer if you know it. e.g. 'Upload your 2025 W-2 from Stripe' rather than 'Upload your W-2'.",
      ),
    detail: z
      .string()
      .describe(
        "One short sentence explaining what you need it for. e.g. 'Need Box 1 wages and Box 2 federal withholding to fill 1040 lines 1a and 25a.'",
      ),
  }),
  outputSchema: z.object({
    id: z.string(),
    requested: z.boolean(),
  }),
  execute: async (input, context) => {
    const { supabase, userId, filingId } = await requireUserContext(context);

    // Dedup: one open|processing card per documentType. If Luca calls
    // this tool twice for "W-2" in the same turn (or across turns
    // before the user uploaded), we return the existing card's id
    // instead of stacking duplicates on the dashboard. The user only
    // ever has one Upload button per document to click.
    const { data: existing, error: findErr } = await supabase
      .from("requested_actions")
      .select("id")
      .eq("user_id", userId)
      .eq("tax_year", input.year)
      .ilike("document_type", input.documentType)
      .in("status", ["open", "processing"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (findErr) {
      throw new Error(`request-document-upload find: ${findErr.message}`);
    }
    if (existing && existing.length > 0) {
      return { id: existing[0].id as string, requested: false };
    }

    const id = crypto.randomUUID();
    const { error } = await supabase.from("requested_actions").insert({
      id,
      user_id: userId,
      filing_id: filingId,
      tax_year: input.year,
      kind: "upload",
      title: input.title,
      detail: input.detail,
      document_type: input.documentType,
      accept_pattern: "application/pdf,image/png,image/jpeg,image/webp",
      status: "open",
    });
    if (error) {
      throw new Error(`request-document-upload insert: ${error.message}`);
    }
    return { id, requested: true };
  },
});
