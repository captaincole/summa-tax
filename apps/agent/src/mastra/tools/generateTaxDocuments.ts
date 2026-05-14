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
import { evaluateAllForms } from "../forms/engine";
import { loadFromFixtures, type Catalog } from "../forms/catalog";
// Explicit register() calls so the bundler / dev server can't tree-shake
// the side-effect-import idiom. Idempotent — bindings overwrite themselves
// if called twice.
import { register as registerForm1040 } from "../forms/federal/1040/bindings";
import { register as registerForm540 } from "../forms/state/ca/540/bindings";
registerForm1040();
registerForm540();
import { fillForm1040 } from "../forms/render/fillForm1040";
import { requireUserContext } from "./userContext";

const BLANK_1040_PATH = resolve(projectRoot, "ref/forms/f1040-2025.pdf");
const BLANK_540_PATH = resolve(projectRoot, "ref/forms/state/ca/2025-540.pdf");

// Combined catalog — both federal and CA forms loaded into one Catalog so
// cross-form refs (540 line 13 → 1040 line 11b) resolve during the
// fixpoint evaluation.
const CATALOG_FILES = [
  resolve(projectRoot, "ref/forms/form-1040-2025.catalog.json"),
  resolve(projectRoot, "ref/forms/state/ca/form-540-2025.catalog.json"),
];
const SCENARIO_FORM_IDS = ["form-1040", "form-540"];

let catalogPromise: Promise<Catalog> | null = null;
function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) catalogPromise = loadFromFixtures(CATALOG_FILES);
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

function refundOrOwed(
  form: EvaluatedForm<AnyFormField>,
  refundFieldId: string,
  owedFieldId: string,
): { kind: "refund" | "owed" | "balanced"; amount: number } {
  const refund = lineValue(form, refundFieldId);
  const owed = lineValue(form, owedFieldId);
  if (refund !== null && refund > 0) return { kind: "refund", amount: refund };
  if (owed !== null && owed > 0) return { kind: "owed", amount: owed };
  return { kind: "balanced", amount: 0 };
}

function countFields(form: EvaluatedForm<AnyFormField>): {
  ok: number;
  blocked: number;
  unsupported: number;
} {
  const ok = form.fields.filter((f) => f.result.ok).length;
  const unsupported = form.fields.filter(
    (f) => !f.result.ok && f.result.unsupported,
  ).length;
  return {
    ok,
    blocked: form.fields.length - ok - unsupported,
    unsupported,
  };
}

export const generateTaxDocuments = createTool({
  id: "generate-tax-documents",
  description:
    "Render the taxpayer's filed forms as PDFs using the form engine. Runs the multi-form evaluator against the current facts and decisions, looks up each catalog field's PDF widget, and writes the value. Returns /documents/{id} URLs for each filed form plus a JSON sidecar with the evaluated forms. Call at hand-off (no pending decisions, all required facts present). Marked draft / not-for-filing — a CPA reviews before submission. Currently produces Form 1040 always; CA Form 540 when the taxpayer is a CA resident (must_file_ca_540 = true). Form 8949 and Schedule D are out of scope until those forms are ingested into the catalog.",
  inputSchema: z.object({
    year: z.number().int(),
  }),
  outputSchema: z.object({
    url: z.string(),
    form540Url: z.string().nullable(),
    sidecarUrl: z.string(),
    linesPopulated: z.number(),
    federalRefundOrOwed: z.object({
      kind: z.enum(["refund", "owed", "balanced"]),
      amount: z.number(),
    }),
    stateRefundOrOwed: z
      .object({
        kind: z.enum(["refund", "owed", "balanced"]),
        amount: z.number(),
      })
      .nullable(),
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

    // ─── Run the multi-form engine (fixpoint) ───
    const ctx: DerivationContext = {
      taxYear: year,
      facts: makeFactsView(factRows),
      decisions: makeDecisionsView(decisionRows),
    };
    const catalog = await getCatalog();
    const { forms } = evaluateAllForms(SCENARIO_FORM_IDS, ctx, catalog);
    const form1040 = forms.get("form-1040")!;
    const form540 = forms.get("form-540")!;

    // ─── Fill the 1040 PDF ───
    // Delegates to fillForm1040 (form-agnostic despite its name — walks
    // the catalog inventory and writes each value to its widget). Soft
    // warnings (widget missing, maxLength exceeded) log but don't fail.
    const blank1040 = readFileSync(BLANK_1040_PATH);
    const {
      pdfBytes: out1040,
      rendered: rendered1040,
      warnings: warn1040,
    } = await fillForm1040({
      blankPdfBytes: blank1040,
      form: form1040,
      catalog,
    });
    for (const w of warn1040) {
      console.warn(`[generate-tax-documents][1040] ${w}`);
    }
    const f1040Doc = await createDocument(supabase, {
      userId,
      category: "drafts",
      filename: `Form 1040 — ${year}`,
      storageSlug: `1040-${year}`,
      extension: "pdf",
      bytes: out1040,
      mimeType: "application/pdf",
      expiresInDays: 30,
      metadata: { formId: "1040", taxYear: year },
    });
    const url = `/documents/${f1040Doc.id}`;

    // ─── Fill the 540 PDF (only when mustFile=true) ───
    let form540Url: string | null = null;
    let stateRefundOrOwed: {
      kind: "refund" | "owed" | "balanced";
      amount: number;
    } | null = null;
    let rendered540Count = 0;
    if (form540.mustFile.ok && form540.mustFile.value) {
      const blank540 = readFileSync(BLANK_540_PATH);
      const {
        pdfBytes: out540,
        rendered: rendered540,
        warnings: warn540,
      } = await fillForm1040({
        blankPdfBytes: blank540,
        form: form540,
        catalog,
      });
      for (const w of warn540) {
        console.warn(`[generate-tax-documents][540] ${w}`);
      }
      const f540Doc = await createDocument(supabase, {
        userId,
        category: "drafts",
        filename: `Form 540 — ${year}`,
        storageSlug: `540-${year}`,
        extension: "pdf",
        bytes: out540,
        mimeType: "application/pdf",
        expiresInDays: 30,
        metadata: { formId: "540", taxYear: year },
      });
      form540Url = `/documents/${f540Doc.id}`;
      rendered540Count = rendered540.size;
      stateRefundOrOwed = refundOrOwed(
        form540,
        "form-540.line.115_refund_or_no_amount_due",
        "form-540.line.111_amount_you_owe",
      );
    }

    // ─── Sidecar — both evaluated forms ───
    const sidecar = {
      userId,
      year,
      generatedAt: new Date().toISOString(),
      forms: {
        "form-1040": serializeForm(form1040),
        ...(form540.mustFile.ok && form540.mustFile.value
          ? { "form-540": serializeForm(form540) }
          : {}),
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

    // ─── Field counts — combined across both forms ───
    const c1040 = countFields(form1040);
    const c540 =
      form540.mustFile.ok && form540.mustFile.value
        ? countFields(form540)
        : { ok: 0, blocked: 0, unsupported: 0 };
    const fieldCounts = {
      ok: c1040.ok + c540.ok,
      blocked: c1040.blocked + c540.blocked,
      unsupported: c1040.unsupported + c540.unsupported,
    };

    return {
      url,
      form540Url,
      sidecarUrl,
      linesPopulated: rendered1040.size + rendered540Count,
      federalRefundOrOwed: refundOrOwed(
        form1040,
        "form-1040.line.34",
        "form-1040.line.37",
      ),
      stateRefundOrOwed,
      fieldCounts,
    };
  },
});
