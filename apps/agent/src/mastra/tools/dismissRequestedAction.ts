import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { requireUserContext } from "./userContext";

// dismiss-requested-action: close a dashboard upload card after Thom has
// successfully ingested the corresponding document. Matches the most
// recent open or processing action with the same document_type for the
// current user.
//
// Returns { dismissed: false } if nothing matched — safe to call
// unconditionally after every ingest; if there was no outstanding
// request for that document, nothing happens.

export const dismissRequestedAction = createTool({
  id: "dismiss-requested-action",
  description:
    "Close a dashboard upload card after you've successfully ingested the document the user uploaded. Pass the same documentType string you used when you called request-document-upload (or the canonical doc name if it was uploaded without a card). Matches the most recent open or processing action with that document type. Safe to call even when no matching card exists.",
  inputSchema: z.object({
    documentType: z
      .string()
      .describe(
        "Canonical document name, e.g. 'W-2', '1099-DIV', '1099-INT', 'K-1'. Match is case-insensitive.",
      ),
  }),
  outputSchema: z.object({
    dismissed: z.boolean(),
    actionId: z.string().nullable(),
  }),
  execute: async (input, context) => {
    const { supabase, userId } = await requireUserContext(context);

    const { data, error } = await supabase
      .from("requested_actions")
      .select("id")
      .eq("user_id", userId)
      .ilike("document_type", input.documentType)
      .in("status", ["open", "processing"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`dismiss-requested-action find: ${error.message}`);
    if (!data || data.length === 0) {
      return { dismissed: false, actionId: null };
    }

    const actionId = data[0].id as string;
    const { error: updateError } = await supabase
      .from("requested_actions")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", actionId);
    if (updateError) {
      throw new Error(`dismiss-requested-action update: ${updateError.message}`);
    }
    return { dismissed: true, actionId };
  },
});
