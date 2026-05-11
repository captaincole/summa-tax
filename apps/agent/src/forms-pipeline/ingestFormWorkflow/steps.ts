// Phase C workflow steps. Three sequential steps:
//   extract  — pdf-lib (AcroForm widgets) + unpdf (per-page text), deterministic
//   classify — Claude with batched tool-use, AI-judgment layer
//   persist  — JSON output (always) + optional Supabase upsert
//
// Each step's outputSchema is the next step's inputSchema, accumulating state
// via .extend() on the carrier schema.

import { promises as fs } from "node:fs";
import { createStep } from "@mastra/core/workflows";
import {
  workflowInputSchema,
  afterExtractSchema,
  afterClassifySchema,
  workflowOutputSchema,
} from "./schemas.js";
import { extractAcroForm } from "../extractAcroForm.js";
import { extractFormText } from "../extractFormText.js";
import { classifyWidgets } from "../classifyWidgets.js";
import { getServiceRoleClient } from "../../mastra/db/supabase.js";

// ─── extract ─────────────────────────────────────────────────────────────

export const extractStep = createStep({
  id: "extract",
  inputSchema: workflowInputSchema,
  outputSchema: afterExtractSchema,
  execute: async ({ inputData }) => {
    const acro = await extractAcroForm(inputData.pdfPath);
    const pages = await extractFormText(inputData.pdfPath);
    return {
      ...inputData,
      widgets: acro.widgets,
      totalPages: acro.totalPages,
      pages,
    };
  },
});

// ─── classify ────────────────────────────────────────────────────────────

export const classifyStep = createStep({
  id: "classify",
  inputSchema: afterExtractSchema,
  outputSchema: afterClassifySchema,
  execute: async ({ inputData }) => {
    const result = await classifyWidgets({
      formId: inputData.formId,
      taxYear: inputData.taxYear,
      jurisdiction: inputData.jurisdiction,
      formTitle: inputData.formTitle,
      widgets: inputData.widgets,
      pages: inputData.pages,
    });
    return {
      ...inputData,
      classifiedFields: result.fields,
      skipped: result.skipped,
      usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cache_creation_input_tokens: result.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: result.usage.cache_read_input_tokens ?? 0,
      },
    };
  },
});

// ─── persist ─────────────────────────────────────────────────────────────

export const persistStep = createStep({
  id: "persist",
  inputSchema: afterClassifySchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    // Join inventory (deterministic extraction) with classifications (AI).
    // Order in the output reflects AcroForm reading order — same ordinal we
    // want in the DB so engine evaluation runs top-to-bottom.
    const classifiedByWidget = new Map(
      inputData.classifiedFields.map((f) => [f.pdfWidgetName, f]),
    );
    type FieldRow = {
      fieldId: string;
      label: string;
      category: string;
      valueType: string;
      pdfWidgetName: string;
      position: { page: number; x: number; y: number };
    };
    const fields: FieldRow[] = [];
    for (const w of inputData.widgets) {
      const c = classifiedByWidget.get(w.fullName);
      if (!c) continue; // widget was skipped by the classifier
      fields.push({
        fieldId: c.fieldId,
        label: c.label,
        category: c.category,
        valueType: c.valueType,
        pdfWidgetName: w.fullName,
        position: { page: w.page, x: w.position.x, y: w.position.y },
      });
    }
    // Multiple widgets can share a fieldId (filing status radio group, etc.).
    // First occurrence wins.
    const seen = new Set<string>();
    const dedupedFields = fields.filter((f) => {
      if (seen.has(f.fieldId)) return false;
      seen.add(f.fieldId);
      return true;
    });

    // Write the JSON artifact — always.
    const payload = {
      form: {
        formId: inputData.formId,
        taxYear: inputData.taxYear,
        jurisdiction: inputData.jurisdiction,
        title: inputData.formTitle,
      },
      fields: dedupedFields,
      _meta: {
        sourcePdf: inputData.pdfPath,
        ingestedAt: new Date().toISOString(),
        totalWidgets: inputData.widgets.length,
        classified: inputData.classifiedFields.length,
        skipped: inputData.skipped.length,
        uniqueFields: dedupedFields.length,
        tokensIn: inputData.usage.input_tokens,
        tokensOut: inputData.usage.output_tokens,
        cacheRead: inputData.usage.cache_read_input_tokens,
        cacheCreate: inputData.usage.cache_creation_input_tokens,
      },
    };
    await fs.writeFile(
      inputData.outputPath,
      JSON.stringify(payload, null, 2),
      "utf8",
    );

    // DB upsert — optional. Mirrors seedFormCatalog's shape.
    let dbWritten = false;
    if (inputData.writeDb) {
      const sb = getServiceRoleClient();
      const { error: formErr } = await sb.from("forms").upsert(
        {
          form_id: inputData.formId,
          tax_year: inputData.taxYear,
          jurisdiction: inputData.jurisdiction,
          title: inputData.formTitle,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "form_id,tax_year" },
      );
      if (formErr) throw new Error(`forms upsert failed: ${formErr.message}`);
      const rows = dedupedFields.map((f, i) => ({
        field_id: f.fieldId,
        form_id: inputData.formId,
        tax_year: inputData.taxYear,
        ordinal: i,
        label: f.label,
        category: f.category,
        value_type: f.valueType,
        pdf_widget_name: f.pdfWidgetName,
        position: f.position,
        updated_at: new Date().toISOString(),
      }));
      const { error: fieldErr } = await sb.from("form_fields").upsert(rows, {
        onConflict: "field_id,tax_year",
      });
      if (fieldErr) {
        throw new Error(`form_fields upsert failed: ${fieldErr.message}`);
      }
      dbWritten = true;
    }

    return {
      outputPath: inputData.outputPath,
      totalWidgets: inputData.widgets.length,
      classifiedCount: inputData.classifiedFields.length,
      skippedCount: inputData.skipped.length,
      uniqueFieldCount: dedupedFields.length,
      dbWritten,
      usage: inputData.usage,
      skipSample: inputData.skipped.slice(0, 8),
    };
  },
});
