import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getAppDb, nowIso } from "../db/appDb";
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
    const { userId, filingId } = await requireUserContext(context);
    const db = getAppDb();

    // Dedup: one open|processing card per documentType. If Luca calls
    // this tool twice for "W-2" in the same turn (or across turns
    // before the user uploaded), we return the existing card's id
    // instead of stacking duplicates on the dashboard. The user only
    // ever has one Upload button per document to click. (The old
    // PostgREST ilike had no wildcards — case-insensitive equality.)
    const existing = await db.execute({
      sql: `SELECT id FROM requested_actions
            WHERE user_id = ? AND tax_year = ?
              AND lower(document_type) = lower(?)
              AND status IN ('open','processing')
            ORDER BY created_at DESC LIMIT 1`,
      args: [userId, input.year, input.documentType],
    });
    if (existing.rows.length > 0) {
      return { id: String(existing.rows[0].id), requested: false };
    }

    const id = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO requested_actions
              (id, user_id, filing_id, tax_year, kind, title, detail,
               document_type, accept_pattern, status, created_at)
            VALUES (?, ?, ?, ?, 'upload', ?, ?, ?, ?, 'open', ?)`,
      args: [
        id,
        userId,
        filingId,
        input.year,
        input.title,
        input.detail,
        input.documentType,
        "application/pdf,image/png,image/jpeg,image/webp",
        nowIso(),
      ],
    });
    return { id, requested: true };
  },
});
