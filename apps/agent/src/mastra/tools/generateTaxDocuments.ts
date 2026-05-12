import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "../paths";
import { listFacts } from "../db/taxFacts";
import { listDecisions } from "../db/aiDecisions";
import { createDocument } from "../db/userDocuments";
import {
  makeDecisionsView,
  makeFactsView,
  type AnyFormField,
  type DerivationContext,
  type EvaluatedForm,
} from "../forms/types";
import { evaluateForm } from "../forms/engine";
import { loadFromFixtures, type Catalog } from "../forms/catalog";
// Explicit register() call so the bundler / dev server can't tree-shake
// the side-effect-import idiom we used previously. Idempotent — bindings
// overwrite themselves if called twice.
import { register as registerForm1040 } from "../forms/generated/form-1040";
registerForm1040();
import { fillForm1040 } from "../forms/render/fillForm1040";
import { requireUserContext } from "./userContext";

const BLANK_FORM_PATH = resolve(projectRoot, "ref/forms/f1040-2025.pdf");

// Phase B/C catalog fixture. Pairs with the AI-generated bindings in
// forms/generated/form-1040.ts. When we flip caseState to loadFromDb in
// Phase F+, this generator should do the same so prod stays consistent.
const CATALOG_FIXTURES = [
  resolve(projectRoot, "fixtures/forms/form-1040-2025.extracted.json"),
];

let catalogPromise: Promise<Catalog> | null = null;
function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) catalogPromise = loadFromFixtures(CATALOG_FIXTURES);
  return catalogPromise;
}

function lineValue(
  form: EvaluatedForm<AnyFormField>,
  fieldId: string,
): number | null {
  const f = form.fields.find((x) => x.fieldId === fieldId);
  if (!f || !f.result.ok) return null;
  const v = f.result.value;
  return typeof v === "number" ? v : null;
}

function serializeForm<F extends AnyFormField>(
  form: EvaluatedForm<F>,
): {
  formId: string;
  jurisdiction: string;
  title: string;
  mustFile: EvaluatedForm<F>["mustFile"];
  fields: Array<{
    fieldId: string;
    label: string;
    category: string;
    valueType: string;
    result: F["result"];
  }>;
} {
  return {
    formId: form.formId,
    jurisdiction: form.jurisdiction,
    title: form.title,
    mustFile: form.mustFile,
    fields: form.fields.map((f) => ({
      fieldId: f.fieldId,
      label: f.label,
      category: f.category,
      valueType: f.valueType,
      result: f.result,
    })),
  };
}

export const generateTaxDocuments = createTool({
  id: "generate-tax-documents",
  description:
    "Render the taxpayer's 1040 as a filled-out PDF using the form engine. Run the 1040 evaluator against the current facts and decisions, look up each catalog field's PDF widget, and write the value. Returns a /documents/{id} URL plus a JSON sidecar with the evaluated form. Call at hand-off (no pending decisions, all required facts present). Marked draft / not-for-filing — a CPA reviews before submission. Currently 1040 only; Schedule D, Form 8949, and CA Form 540 are out of scope until those forms are reintroduced in the new engine.",
  inputSchema: z.object({
    year: z.number().int(),
  }),
  outputSchema: z.object({
    url: z.string(),
    sidecarUrl: z.string(),
    linesPopulated: z.number(),
    federalRefundOrOwed: z.object({
      kind: z.enum(["refund", "owed", "balanced"]),
      amount: z.number(),
    }),
    fieldCounts: z.object({
      ok: z.number(),
      blocked: z.number(),
      unsupported: z.number(),
    }),
  }),
  execute: async (input, context) => {
    const { supabase, userId } = requireUserContext(context);
    const { year } = input;

    // ─── Read state from DB ───
    const [factRows, decisionRows] = await Promise.all([
      listFacts(supabase, { taxYear: year, limit: 500 }),
      listDecisions(supabase, { taxYear: year, limit: 500 }),
    ]);

    // ─── Run the new engine on form-1040 ───
    const ctx: DerivationContext = {
      taxYear: year,
      facts: makeFactsView(factRows),
      decisions: makeDecisionsView(decisionRows),
    };
    const catalog = await getCatalog();
    const form1040 = evaluateForm("form-1040", ctx, catalog);

    // ─── Fill the 1040 PDF ───
    // Delegates to fillForm1040 so the integration test (scripts/integrationAlex.ts)
    // exercises the same code path. Any soft warnings (widget missing,
    // maxLength exceeded) get logged but don't fail the tool — the tool's
    // contract is "render best-effort"; the test treats warnings as fatal.
    const blankBytes = readFileSync(BLANK_FORM_PATH);
    const { pdfBytes: outBytes, rendered, warnings } = await fillForm1040({
      blankPdfBytes: blankBytes,
      form: form1040,
      catalog,
    });
    const linesPopulated = rendered.size;
    for (const w of warnings) {
      console.warn(`[generate-tax-documents] ${w}`);
    }
    const f1040Doc = await createDocument(supabase, {
      userId,
      category: "drafts",
      filename: `Form 1040 — ${year}`,
      storageSlug: `1040-${year}`,
      extension: "pdf",
      bytes: outBytes,
      mimeType: "application/pdf",
      expiresInDays: 30,
      metadata: { formId: "1040", taxYear: year },
    });
    const url = `/documents/${f1040Doc.id}`;

    // ─── Sidecar — evaluated 1040 only ───
    const sidecar = {
      userId,
      year,
      generatedAt: new Date().toISOString(),
      forms: {
        "form-1040": serializeForm(form1040),
      },
    };
    const sidecarBytes = Buffer.from(JSON.stringify(sidecar, null, 2), "utf-8");
    const sidecarDoc = await createDocument(supabase, {
      userId,
      category: "drafts",
      filename: `Forms sidecar — ${year}`,
      storageSlug: `forms-${year}`,
      extension: "json",
      bytes: sidecarBytes,
      mimeType: "application/json",
      expiresInDays: 30,
      metadata: { formId: "sidecar", taxYear: year },
    });
    const sidecarUrl = `/documents/${sidecarDoc.id}`;

    // ─── Refund / owed summary ───
    const refund = lineValue(form1040, "form-1040.line.34");
    const owed = lineValue(form1040, "form-1040.line.37");
    const federalRefundOrOwed = (() => {
      if (refund !== null && refund > 0) {
        return { kind: "refund" as const, amount: refund };
      }
      if (owed !== null && owed > 0) {
        return { kind: "owed" as const, amount: owed };
      }
      return { kind: "balanced" as const, amount: 0 };
    })();

    const okCount = form1040.fields.filter((f) => f.result.ok).length;
    const unsupportedCount = form1040.fields.filter(
      (f) => !f.result.ok && f.result.unsupported,
    ).length;
    const blockedCount = form1040.fields.length - okCount - unsupportedCount;

    return {
      url,
      sidecarUrl,
      linesPopulated,
      federalRefundOrOwed,
      fieldCounts: {
        ok: okCount,
        blocked: blockedCount,
        unsupported: unsupportedCount,
      },
    };
  },
});

