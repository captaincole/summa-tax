// Phase D workflow steps. Four sequential steps:
//   prepare  — load catalog from the JSON fixture (or DB in future)
//   retrieve — per-field hybridSearchRefDocs against the IRS corpus
//   classify — batched Claude tool-use, returns {ruleName, params} per field
//   write    — render bindings into TS source and write to disk
//
// Each step's outputSchema is the next step's inputSchema; the carrier
// accumulates via .extend() (see schemas.ts).

import { promises as fs } from "node:fs";
import { createStep } from "@mastra/core/workflows";
import {
  workflowInputSchema,
  afterPrepareSchema,
  afterRetrieveSchema,
  afterClassifySchema,
  workflowOutputSchema,
  type AfterClassify,
  type AfterRetrieve,
} from "./schemas.js";
import { loadFromFixture, type FieldInventory } from "../../mastra/forms/catalog.js";
import { retrieveContextPerField } from "../retrieveContext.js";
import { classifyBindings } from "../classifyBindings.js";
import { renderBindings } from "../renderBindings.js";

// ─── prepare ─────────────────────────────────────────────────────────────

export const prepareStep = createStep({
  id: "prepare",
  inputSchema: workflowInputSchema,
  outputSchema: afterPrepareSchema,
  execute: async ({ inputData }) => {
    const catalog = await loadFromFixture(inputData.catalogPath);
    const form = catalog.getForm(inputData.formId);
    if (!form) {
      throw new Error(
        `prepare: no form "${inputData.formId}" in catalog at ${inputData.catalogPath}`,
      );
    }
    const fields = catalog.getFields(inputData.formId);
    if (fields.length === 0) {
      throw new Error(
        `prepare: form "${inputData.formId}" has no fields in catalog`,
      );
    }
    return {
      ...inputData,
      jurisdiction: form.jurisdiction,
      formTitle: form.title,
      fields,
    };
  },
});

// ─── retrieve ────────────────────────────────────────────────────────────

export const retrieveStep = createStep({
  id: "retrieve",
  inputSchema: afterPrepareSchema,
  outputSchema: afterRetrieveSchema,
  execute: async ({ inputData }) => {
    const t0 = Date.now();
    const retrieved = await retrieveContextPerField(
      {
        fields: inputData.fields,
        formTitle: inputData.formTitle,
        topK: 3,
        concurrency: 10,
      },
      (done, total) => {
        if (done % 25 === 0 || done === total) {
          process.stderr.write(
            `    retrieve: ${done}/${total} fields (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`,
          );
        }
      },
    );
    const retrievedContext = retrieved.map((r) => ({
      fieldId: r.fieldId,
      blocks: r.blocks.map((b) => ({
        blockId: b.blockId,
        docId: b.docId,
        text: b.text,
        score: typeof b.score === "number" ? b.score : undefined,
      })),
    }));
    return { ...inputData, retrievedContext };
  },
});

// ─── classify ────────────────────────────────────────────────────────────

export const classifyStep = createStep({
  id: "classify",
  inputSchema: afterRetrieveSchema,
  outputSchema: afterClassifySchema,
  execute: async ({ inputData }) => {
    const result = await classifyBindings(
      {
        formId: inputData.formId,
        taxYear: inputData.taxYear,
        jurisdiction: inputData.jurisdiction,
        formTitle: inputData.formTitle,
        fields: inputData.fields,
        retrievedContext: inputData.retrievedContext,
      },
      (i, total, size) => {
        process.stderr.write(
          `    classify batch ${i + 1}/${total} (${size} fields)\n`,
        );
      },
    );
    return {
      ...inputData,
      bindings: result.bindings,
      mustFile: result.mustFile,
      usage: result.usage,
    };
  },
});

// ─── write ───────────────────────────────────────────────────────────────

export const writeStep = createStep({
  id: "write",
  inputSchema: afterClassifySchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    const fields: FieldInventory[] = inputData.fields;
    const source = renderBindings({
      formId: inputData.formId,
      taxYear: inputData.taxYear,
      jurisdiction: inputData.jurisdiction,
      formTitle: inputData.formTitle,
      fields,
      bindings: inputData.bindings,
      mustFile: inputData.mustFile,
    });
    await fs.writeFile(inputData.outputPath, source, "utf8");

    const ruleBreakdown = countByRule(inputData);
    const boundFieldIds = new Set(inputData.bindings.map((b) => b.fieldId));
    const unboundCount = inputData.fields.filter(
      (f) => !boundFieldIds.has(f.fieldId),
    ).length;

    return {
      outputPath: inputData.outputPath,
      fieldCount: inputData.fields.length,
      bindingsCount: inputData.bindings.length,
      unboundCount,
      ruleBreakdown,
      retrievalCount: inputData.retrievedContext.length,
      usage: inputData.usage,
    };
  },
});

function countByRule(c: AfterClassify): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const b of c.bindings) {
    counts[b.ruleName] = (counts[b.ruleName] ?? 0) + 1;
  }
  return counts;
}

// Unused — kept for the type re-export so adjacent modules don't have to
// re-import the carrier types directly.
export type { AfterRetrieve };
