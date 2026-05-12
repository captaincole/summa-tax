import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { PDFDocument, PDFTextField, PDFCheckBox } from "pdf-lib";
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
import {
  loadFromFixtures,
  type Catalog,
  type FieldInventory,
} from "../forms/catalog";
// Explicit register() call so the bundler / dev server can't tree-shake
// the side-effect-import idiom we used previously. Idempotent — bindings
// overwrite themselves if called twice.
import { register as registerForm1040 } from "../forms/generated/form-1040";
registerForm1040();
import { verifiedWidget } from "../../forms-pipeline/verifiedWidgets";
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

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n === 0) return "0";
  return Math.round(n).toString();
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
    const blankBytes = readFileSync(BLANK_FORM_PATH);
    const pdf = await PDFDocument.load(blankBytes);
    const pdfForm = pdf.getForm();

    const setText = (widgetName: string, value: string) => {
      if (!value) return;
      try {
        const f = pdfForm.getField(widgetName);
        if (f instanceof PDFTextField) f.setText(value);
      } catch (err) {
        console.warn(
          `[generate-tax-documents] setText failed for ${widgetName}:`,
          err,
        );
      }
    };
    const check = (widgetName: string) => {
      try {
        const f = pdfForm.getField(widgetName);
        if (f instanceof PDFCheckBox) f.check();
      } catch (err) {
        console.warn(
          `[generate-tax-documents] check failed for ${widgetName}:`,
          err,
        );
      }
    };

    // Generic walk over catalog fields. Each catalog field carries its
    // PDF widget name (from Phase C extraction); each evaluated result is
    // matched to that widget and filled by valueType. The verified-widgets
    // override map takes precedence over the AI's catalog mapping for
    // fields where we know Phase C drifted (see verifiedWidgets.ts).
    let linesPopulated = 0;
    for (const field of form1040.fields) {
      const inv = catalog.getField(field.fieldId);
      if (!inv) continue;
      if (!field.result.ok) continue;
      const value = field.result.value;
      if (value === null || value === undefined) continue;

      // multi_select fields don't have a single pdfWidgetName — each option
      // maps to its own widget. fillByType iterates options when valueType
      // is multi_select; for other types it fills the resolved widgetName.
      const widgetName =
        verifiedWidget("form-1040", field.fieldId) ?? inv.pdfWidgetName;
      const filled = fillByType(setText, check, widgetName, inv, value);
      if (filled) linesPopulated++;
    }

    pdfForm.flatten();

    // ─── Persist 1040 PDF ───
    const outBytes = Buffer.from(await pdf.save());
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

// Fill widgets based on the field's valueType + the engine's evaluated
// value. Returns true if at least one widget was touched.
//
// For single-widget types (numeric/text/boolean/date) the caller supplies
// the resolved widgetName (verified overlay or catalog default). For
// multi_select the widget mapping lives per-option in the catalog, so this
// function ignores the passed widgetName and iterates inv.options instead.
//
// Numeric zeros are written as "0" — they distinguish "engine computed
// zero" from "engine didn't compute this at all" (the latter is
// unsupported/blocked and gets no widget fill).
function fillByType(
  setText: (widgetName: string, value: string) => void,
  check: (widgetName: string) => void,
  widgetName: string | undefined,
  inv: FieldInventory,
  value: unknown,
): boolean {
  switch (inv.valueType) {
    case "numeric": {
      if (!widgetName) return false;
      if (typeof value === "number" && Number.isFinite(value)) {
        setText(widgetName, fmtMoney(value));
        return true;
      }
      return false;
    }
    case "text": {
      if (!widgetName) return false;
      if (typeof value === "string" && value.length > 0) {
        setText(widgetName, value);
        return true;
      }
      return false;
    }
    case "boolean": {
      if (!widgetName) return false;
      if (value === true) {
        check(widgetName);
        return true;
      }
      return false;
    }
    case "date": {
      if (!widgetName) return false;
      if (typeof value === "string" && value.length > 0) {
        setText(widgetName, value);
        return true;
      }
      return false;
    }
    case "multi_select": {
      // value should be string[] — the selected option values. Check each
      // option's PDF widget by looking it up in inv.options.
      if (!Array.isArray(value) || !inv.options) return false;
      let touched = false;
      for (const selected of value) {
        const opt = inv.options.find((o) => o.value === selected);
        if (!opt) continue;
        check(opt.pdfWidgetName);
        touched = true;
      }
      return touched;
    }
    case "single_select":
      // No live single_select renderer path — all current radio groups are
      // modeled as multi_select. If we ever introduce a true single_select
      // (one widget, one decision-driven value), add the branch here.
      return false;
  }
  return false;
}
