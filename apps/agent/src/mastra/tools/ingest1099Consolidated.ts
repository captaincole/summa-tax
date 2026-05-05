import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordFact } from "../db/taxFacts";
import { recordDecision } from "../db/aiDecisions";
import {
  makeDividendFactKey,
  makeTradeFactKey,
  type DividendFactValue,
  type TradeFactValue,
} from "../facts";
import { requireUserContext } from "./userContext";

// Ingest a consolidated 1099 (E*TRADE-style multi-section statement) as
// structured tax_facts + a few broker-reported AI decisions.
//
// Thom (vision-capable) reads the 1099 PDF and maps whatever broker-specific
// labels are used to IRS-canonical box numbers. The schema below is what
// the LLM should produce; the tool writes it to the DB.
//
// What gets written per call:
//   - 1 DividendFactValue if `div` is present
//   - 1 TradeFactValue per trade in `b.trades`
//   - 1 ai_decision per trade (`decisions.trade.{tradeId}.form_8949_box`)
//     derived mechanically from the broker-reported (term, basisReported)
//     pair — no Nynaeve grounding needed since the broker classified it.
//   - 1 ai_decision (`decisions.scope.has_reportable_sales` = true) if
//     trades are present.
//
// (1099-INT / 1099-MISC / 1099-OID sections will be added when we have a
// scenario that uses them. For now, only DIV + B are accepted.)

const AddressSchema = z.object({
  line1: z.string(),
  line2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
});

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const tradeIdFor = (t: {
  symbol?: string;
  cusip?: string;
  description: string;
  dateAcquired: string;
  dateSold: string;
  quantity: number;
}): string => {
  const ticker = t.symbol ?? t.cusip ?? slugify(t.description);
  // MM/DD/YY → YYYY-MM-DD slug for stable, sortable IDs
  const slugDate = (d: string) => {
    const m = d.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (!m) return slugify(d);
    const [, mm, dd, yy] = m;
    return `20${yy}-${mm}-${dd}`;
  };
  return `${slugify(ticker)}-${slugDate(t.dateSold)}-q${t.quantity}`;
};

// Map broker-reported (term, basisReported) → Form 8949 box.
const boxFor = (term: "short_term" | "long_term" | "unknown", basisReported: boolean): string => {
  if (term === "short_term") return basisReported ? "partI.boxA" : "partI.boxB";
  if (term === "long_term") return basisReported ? "partII.boxD" : "partII.boxE";
  // Unknown term → Box B or Box E (form 8949 instructions cover this).
  return basisReported ? "partI.boxA" : "partI.boxB";
};

export const ingest1099Consolidated = createTool({
  id: "ingest-1099-consolidated",
  description:
    "Ingest a consolidated 1099 (a multi-section broker statement). Thom reads the PDF and maps each broker's labels to IRS-canonical box numbers, then calls this tool with the structured data. Writes one tax fact for the dividend section, one per trade in the B section, and broker-reported classification decisions. Call ONCE per consolidated 1099. INT/MISC/OID sections are not yet supported — tell the user to call out what you see in those sections so we can add support when we hit a scenario that needs it.",
  inputSchema: z.object({
    year: z.number().int(),
    accountSlug: z
      .string()
      .optional()
      .describe(
        "Stable slug for this account in fact keys. Defaults to slugified payer name. Use a single short token like 'apex-individual' or 'fidelity-brokerage'.",
      ),
    payer: z.object({
      name: z.string(),
      tin: z.string().describe("Federal Identification Number printed on the 1099"),
      phone: z.string().optional(),
      address: AddressSchema.optional(),
    }),
    accountNumber: z.string(),
    div: z
      .object({
        box1a: z.number().optional().describe("Total ordinary dividends"),
        box1b: z.number().optional().describe("Qualified dividends"),
        box2a: z.number().optional().describe("Total capital gain distributions"),
        box2b: z.number().optional().describe("Unrecap. Sec. 1250 gain"),
        box2d: z.number().optional().describe("Collectibles (28%) gain"),
        box3: z.number().optional().describe("Non-dividend distributions"),
        box4: z.number().optional().describe("Federal income tax withheld"),
        box5: z.number().optional().describe("Section 199A dividends"),
        box6: z.number().optional().describe("Investment expenses"),
        box7: z.number().optional().describe("Foreign tax paid"),
        box9: z.number().optional(),
        box10: z.number().optional(),
        box12: z.number().optional().describe("Exempt-interest dividends"),
        box13: z.number().optional(),
      })
      .optional()
      .describe(
        "1099-DIV section. Pass only the boxes that have non-zero values; omit the entire object if the section is absent or all-zero.",
      ),
    b: z
      .object({
        trades: z.array(
          z.object({
            description: z.string().describe("Security description, e.g. 'APPLE INC'"),
            cusip: z.string().optional(),
            symbol: z.string().optional().describe("Ticker symbol"),
            quantity: z.number(),
            dateAcquired: z.string().describe("MM/DD/YY as printed on the 1099-B"),
            dateSold: z.string().describe("MM/DD/YY as printed"),
            proceeds: z.number(),
            costBasis: z.number().optional().describe("Omit for noncovered securities where basis isn't reported"),
            adjustmentCode: z.string().optional().describe("Form 8949 column (f) code, if present"),
            adjustmentAmount: z.number().optional(),
            washSaleLossDisallowed: z.number().optional(),
            federalIncomeTaxWithheld: z.number().optional(),
            term: z
              .enum(["short_term", "long_term", "unknown"])
              .describe(
                "Holding period. Read this from the 1099-B section header on the PDF: 'Long Term' / 'Short Term' / 'Unknown Term'. Don't compute it from dates — trust what the broker reported.",
              ),
            basisReported: z
              .boolean()
              .describe(
                "True for 'Covered Securities' (basis reported to IRS), false for 'Noncovered Securities'. Read from the section header.",
              ),
          }),
        ),
      })
      .optional()
      .describe(
        "1099-B section with per-trade detail. Omit the entire object if there are no reportable sales.",
      ),
    sourceNote: z
      .string()
      .default("Consolidated 1099 ingested via structured payload"),
  }),
  outputSchema: z.object({
    accountSlug: z.string(),
    factsWritten: z.number(),
    decisionsWritten: z.number(),
    tradeIds: z.array(z.string()),
  }),
  execute: async (input, context) => {
    const { supabase, userId } = requireUserContext(context);
    const { year, sourceNote } = input;
    const slug =
      input.accountSlug ||
      slugify(input.payer.name) ||
      `tin-${input.payer.tin.replace(/-/g, "")}`;

    let factsWritten = 0;
    let decisionsWritten = 0;
    const tradeIds: string[] = [];

    // ─── Dividend section ───
    if (input.div) {
      const value: DividendFactValue = {
        payerName: input.payer.name,
        payerTin: input.payer.tin,
        ...input.div,
      };
      await recordFact(supabase, {
        id: crypto.randomUUID(),
        userId,
        taxYear: year,
        category: "investment_income",
        key: makeDividendFactKey(slug),
        value,
        sourceNote,
      });
      factsWritten++;
    }

    // ─── 1099-B trades ───
    if (input.b && input.b.trades.length > 0) {
      for (const t of input.b.trades) {
        const tradeId = tradeIdFor(t);
        tradeIds.push(tradeId);

        const trade: TradeFactValue = {
          tradeId,
          description: t.description,
          cusip: t.cusip,
          symbol: t.symbol,
          quantity: t.quantity,
          dateAcquired: t.dateAcquired,
          dateSold: t.dateSold,
          proceeds: t.proceeds,
          costBasis: t.costBasis ?? 0,
          adjustmentCode: t.adjustmentCode,
          adjustmentAmount: t.adjustmentAmount,
        };
        await recordFact(supabase, {
          id: crypto.randomUUID(),
          userId,
          taxYear: year,
          category: "investment_income",
          key: makeTradeFactKey(slug, tradeId),
          value: trade,
          sourceNote,
        });
        factsWritten++;

        // Auto-record the form_8949_box decision since broker classified it.
        // Skips Nynaeve grounding by writing directly through recordDecision —
        // the input is broker-reported, no judgment.
        const box = boxFor(t.term, t.basisReported);
        await recordDecision(supabase, {
          id: crypto.randomUUID(),
          userId,
          taxYear: year,
          decisionKey: `decisions.trade.${tradeId}.form_8949_box`,
          decision: box,
          rationale:
            `Broker reported ${t.term === "long_term" ? "long-term" : t.term === "short_term" ? "short-term" : "unknown-term"} ` +
            `${t.basisReported ? "covered" : "noncovered"} sale → Form 8949 ${box}.`,
          supportingFactKeys: [makeTradeFactKey(slug, tradeId)],
          confidence: "high",
          sourceNote: "Auto-classified during 1099 ingest (broker-reported section)",
        });
        decisionsWritten++;
      }

      // Scope decision: reportable sales exist
      await recordDecision(supabase, {
        id: crypto.randomUUID(),
        userId,
        taxYear: year,
        decisionKey: "decisions.scope.has_reportable_sales",
        decision: true,
        rationale:
          `Consolidated 1099 from ${input.payer.name} contains a populated 1099-B section with ${input.b.trades.length} reportable sale(s).`,
        supportingFactKeys: tradeIds.map((id) => makeTradeFactKey(slug, id)),
        confidence: "high",
        sourceNote: "Auto-recorded during 1099 ingest",
      });
      decisionsWritten++;
    }

    return { accountSlug: slug, factsWritten, decisionsWritten, tradeIds };
  },
});
