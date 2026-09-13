import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createDocument } from "../db/userDocuments";
import {
  type AnyFormField,
  type EvaluatedForm,
} from "../../engine/types";
import { renderForm } from "../../engine";
import { loadAndEvaluateScenario } from "../loadScenario";
import { FORMS } from "../../engine/registry";
import { requireUserContext } from "./userContext";

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
  /** Audit trail for the must-file determination — present whenever the
   *  resolver populated it for this form. See EngineDerivation. */
  mustFileDerivation: EvaluatedForm<F>["mustFileDerivation"];
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
    mustFileDerivation: form.mustFileDerivation,
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
    "Render the taxpayer's filed forms as PDFs using the form engine. Runs the multi-form evaluator against the current facts and decisions, looks up each catalog field's PDF widget, and writes the value. Returns a list of {formId, url} entries for each form whose mustFile predicate evaluates true, plus a JSON sidecar with the evaluated forms. Call at hand-off (no pending decisions, all required facts present). Marked draft / not-for-filing — a CPA reviews before submission. Produces Form 1040, plus any of: Form 8949 / Schedule D when the taxpayer has reportable capital sales, Schedule CA (540) and Form 540 when the taxpayer is a CA filer.",
  inputSchema: z.object({
    year: z.number().int(),
  }),
  outputSchema: z.object({
    /** Convenience: the 1040 URL (always present; 1040 is filed for every scenario we model). */
    url: z.string(),
    /** Convenience: the 540 URL (null when not filed). Preserved for prior consumers. */
    form540Url: z.string().nullable(),
    /** Every rendered form keyed by formId — the canonical list going forward. */
    documents: z.array(
      z.object({
        formId: z.string(),
        url: z.string(),
        filename: z.string(),
      }),
    ),
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
    const { scope, userId, filingId, taxYear, authEmail } =
      await requireUserContext(context);
    const { year } = input;

    const scenario = await loadAndEvaluateScenario(scope, { id: filingId, taxYear }, authEmail);
    const { forms } = scenario;

    // ─── Render every form whose mustFile predicate evaluates true ───
    // 1040 is filed unconditionally for every scenario we model (its
    // mustFile reads the decisions.scope.must_file_federal flag). Other
    // forms gate per-scenario via their own mustFile decisions —
    // Alejandro files 8949/Schedule D/Schedule CA/540; Alex files only
    // 1040 + 540.
    const documents: Array<{ formId: string; url: string; filename: string }> = [];
    const sidecarForms: Record<string, ReturnType<typeof serializeForm>> = {};
    let totalLinesPopulated = 0;
    let totalCounts = { ok: 0, blocked: 0, unsupported: 0 };

    for (const spec of FORMS) {
      const form = forms.get(spec.formId);
      if (!form) {
        console.warn(
          `[generate-tax-documents] no evaluation result for ${spec.formId}`,
        );
        continue;
      }
      if (!form.mustFile.ok || !form.mustFile.value) {
        // Form is out of scope for this scenario — skip rendering, don't
        // include in sidecar, no field counts contributed.
        continue;
      }

      const { pdfBytes, rendered, warnings } = await renderForm(scenario, spec.formId);
      for (const w of warnings) {
        console.warn(`[generate-tax-documents][${spec.formId}] ${w}`);
      }
      const filename = `${spec.displayName} — ${year}`;
      const doc = await createDocument({
        userId,
        filingId,
        category: "drafts",
        filename,
        storageSlug: `${spec.shortId}-${year}`,
        extension: "pdf",
        bytes: pdfBytes,
        mimeType: "application/pdf",
        expiresInDays: 30,
        metadata: { formId: spec.shortId, taxYear: year },
      });
      const url = `/documents/${doc.id}`;
      documents.push({ formId: spec.formId, url, filename });
      sidecarForms[spec.formId] = serializeForm(form);
      totalLinesPopulated += rendered.size;
      const counts = countFields(form);
      totalCounts = {
        ok: totalCounts.ok + counts.ok,
        blocked: totalCounts.blocked + counts.blocked,
        unsupported: totalCounts.unsupported + counts.unsupported,
      };
    }

    // ─── Sidecar — every rendered form ───
    const sidecar = {
      userId,
      year,
      generatedAt: new Date().toISOString(),
      forms: sidecarForms,
    };
    const sidecarBytes = Buffer.from(JSON.stringify(sidecar, null, 2), "utf-8");
    const sidecarDoc = await createDocument({
      userId,
      filingId,
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

    // ─── Refund/owed summaries ───
    // 1040 is always present; 540 is the conditional state-level analog.
    const form1040 = forms.get("form-1040")!;
    const form540 = forms.get("form-540");
    const federalRefundOrOwed = refundOrOwed(
      form1040,
      "form-1040.line.34",
      "form-1040.line.37",
    );
    const stateRefundOrOwed =
      form540 && form540.mustFile.ok && form540.mustFile.value
        ? refundOrOwed(
            form540,
            "form-540.line.115_refund_or_no_amount_due",
            "form-540.line.111_amount_you_owe",
          )
        : null;

    // ─── Backwards-compat URL fields ───
    const url1040 = documents.find((d) => d.formId === "form-1040")?.url ?? "";
    const url540 = documents.find((d) => d.formId === "form-540")?.url ?? null;

    return {
      url: url1040,
      form540Url: url540,
      documents,
      sidecarUrl,
      linesPopulated: totalLinesPopulated,
      federalRefundOrOwed,
      stateRefundOrOwed,
      fieldCounts: totalCounts,
    };
  },
});
