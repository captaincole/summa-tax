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
// Side-effect import: registers form-1040 bindings with the engine.
import "../forms/generated/form-1040";
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

// Filing-status checkboxes — the AI's current bindings have all five
// bound to lookupDecision("decisions.scope.filing_status"), which returns
// the same string for every widget. Until we add an equalsDecision rule
// or similar, the renderer maps the string to the matching checkbox.
//
// TODO(rules): add an `equalsDecision({ decisionKey, value })` rule that
// returns a boolean — true when the decision matches the value. Re-bind
// each filing_status_* field to that rule and delete this map. Same
// pattern will apply to any other radio-group widgets we encounter.
const FILING_STATUS_FIELD_IDS: Record<string, string> = {
  single: "form-1040.header.filing_status_single",
  married_filing_jointly: "form-1040.header.filing_status_mfj",
  mfj: "form-1040.header.filing_status_mfj",
  married_filing_separately: "form-1040.header.filing_status_mfs",
  mfs: "form-1040.header.filing_status_mfs",
  head_of_household: "form-1040.header.filing_status_hoh",
  hoh: "form-1040.header.filing_status_hoh",
  qualifying_surviving_spouse: "form-1040.header.filing_status_qss",
  qss: "form-1040.header.filing_status_qss",
};

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n === 0) return "0";
  return Math.round(n).toString();
}

interface AddressShape {
  line1?: string;
  street?: string;
  line2?: string;
  apt?: string;
  city?: string;
  state?: string;
  zip?: string;
  zipCode?: string;
}

function parseAddress(addr: unknown): {
  street: string;
  apt: string;
  city: string;
  state: string;
  zip: string;
} {
  if (typeof addr === "string") {
    return { street: addr, apt: "", city: "", state: "", zip: "" };
  }
  if (addr && typeof addr === "object") {
    const a = addr as AddressShape;
    return {
      street: String(a.line1 ?? a.street ?? ""),
      apt: String(a.line2 ?? a.apt ?? ""),
      city: String(a.city ?? ""),
      state: String(a.state ?? ""),
      zip: String(a.zip ?? a.zipCode ?? ""),
    };
  }
  return { street: "", apt: "", city: "", state: "", zip: "" };
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

    const factMap = new Map<string, unknown>();
    for (const r of factRows) if (!factMap.has(r.key)) factMap.set(r.key, r.value);

    const filingStatusDecision = decisionRows.find(
      (d) => d.decisionKey === "decisions.scope.filing_status",
    );
    const filingStatus = filingStatusDecision
      ? String(filingStatusDecision.decision)
      : "";

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
    // matched to that widget and filled by valueType.
    let linesPopulated = 0;
    for (const field of form1040.fields) {
      const inv = catalog.getField(field.fieldId);
      if (!inv?.pdfWidgetName) continue;
      if (!field.result.ok) continue;
      const value = field.result.value;
      if (value === null || value === undefined) continue;

      const filled = fillByType(setText, check, inv, value);
      if (filled) linesPopulated++;
    }

    // ─── Special-case: filing status checkboxes ───
    // Override the generic walk by checking the one widget matching the
    // taxpayer's filing-status decision. Until we add an equalsDecision
    // rule, this lives in the renderer.
    const fsFieldId = FILING_STATUS_FIELD_IDS[filingStatus];
    if (fsFieldId) {
      const inv = catalog.getField(fsFieldId);
      if (inv?.pdfWidgetName) {
        check(inv.pdfWidgetName);
        linesPopulated++;
      }
    }

    // ─── Special-case: address decomposition ───
    // identity.address is a structured fact { line1, city, state, zip };
    // the catalog has separate widgets for street/apt/city/state/zip but
    // only the street widget got bound to the address fact (the others
    // are marked unsupported). Decompose here so all five fields fill.
    //
    // TODO(facts): split identity.address into separate sub-facts
    // (identity.address.street, .city, .state, .zip) at ingest time so the
    // AI can bind each subfield to lookupFact directly. Then drop this
    // renderer-side special case and let the generic walk handle them.
    const addr = parseAddress(factMap.get("identity.address"));
    const addrParts: Array<[string, string]> = [
      ["form-1040.header.address_street", addr.street],
      ["form-1040.header.address_apt", addr.apt],
      ["form-1040.header.address_city", addr.city],
      ["form-1040.header.address_state", addr.state],
      ["form-1040.header.address_zip", addr.zip],
    ];
    for (const [fieldId, value] of addrParts) {
      if (!value) continue;
      const inv = catalog.getField(fieldId);
      if (!inv?.pdfWidgetName) continue;
      setText(inv.pdfWidgetName, value);
      linesPopulated++;
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

// Fill a single widget based on the field's valueType + the engine's
// evaluated value. Returns true if a widget was actually touched.
function fillByType(
  setText: (widgetName: string, value: string) => void,
  check: (widgetName: string) => void,
  inv: FieldInventory,
  value: unknown,
): boolean {
  if (!inv.pdfWidgetName) return false;
  switch (inv.valueType) {
    case "numeric": {
      if (typeof value === "number" && Number.isFinite(value)) {
        // Skip zeros — the form looks cleaner with empty cells than "0"
        // on every unused line, and engine-side zeros are usually
        // unsupported-as-0 cascades from fromFields.
        if (value === 0) return false;
        setText(inv.pdfWidgetName, fmtMoney(value));
        return true;
      }
      return false;
    }
    case "text": {
      if (typeof value === "string" && value.length > 0) {
        setText(inv.pdfWidgetName, value);
        return true;
      }
      return false;
    }
    case "boolean": {
      if (value === true) {
        check(inv.pdfWidgetName);
        return true;
      }
      return false;
    }
    case "date": {
      if (typeof value === "string" && value.length > 0) {
        setText(inv.pdfWidgetName, value);
        return true;
      }
      return false;
    }
    case "single_select":
      // Handled by the renderer's filing-status special-case for now.
      return false;
  }
  return false;
}
