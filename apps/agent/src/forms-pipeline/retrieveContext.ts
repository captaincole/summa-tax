// Per-field IRS-instruction retrieval. Phase D feeds the binding classifier
// the most relevant 2-3 blocks from the IRS reference corpus for each form
// field, so Claude can ground rule + params choices against the actual
// regulatory text instead of guessing from the field label alone.
//
// Uses the existing hybridSearchRefDocs (the grounding review's retrieval path): FTS leg
// + voyage-law-2 vector leg + voyage rerank-2.5. Runs per-field in parallel
// with a concurrency cap so we don't burst the Voyage API.

import { hybridSearchRefDocs } from "../mastra/db/refDocs.js";
import type { FieldInventory } from "../engine/catalog.js";

// Minimal block shape — the classifier only needs the citation (for the
// rationale's "ref:" tags) and the text body. Keeping this small means the
// workflow's Zod carrier schema matches it exactly.
export interface RetrievedBlock {
  blockId: string;
  docId: string;
  text: string;
  score?: number;
}

export interface RetrievedFieldContext {
  fieldId: string;
  blocks: RetrievedBlock[];
}

export interface RetrieveOpts {
  fields: FieldInventory[];
  formTitle: string;
  /** Top-K blocks retained per field after rerank. */
  topK?: number;
  /** How many fields to retrieve for in parallel. */
  concurrency?: number;
  /** Skip Voyage rerank-2.5 — falls back to merged FTS + vector ordering.
   *  Default true for Phase D because the 197-field × 100-candidate volume
   *  trips the rerank-2.5 TPM ceiling (2M tok/min), and binding
   *  classification doesn't need rerank-grade precision. */
  noRerank?: boolean;
  /** Candidates pulled from each retrieval leg before merging. Smaller =
   *  less data through Voyage = faster + lower cost. Default 20 (vs
   *  hybridSearchRefDocs's default of 50) since we keep topK at 3. */
  candidatesPerLeg?: number;
}

export async function retrieveContextPerField(
  opts: RetrieveOpts,
  onProgress?: (done: number, total: number) => void,
): Promise<RetrievedFieldContext[]> {
  const topK = opts.topK ?? 3;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 10, 25));
  const noRerank = opts.noRerank ?? true;
  const candidatesPerLeg = opts.candidatesPerLeg ?? 20;

  const out: RetrievedFieldContext[] = new Array(opts.fields.length);
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= opts.fields.length) return;
      const field = opts.fields[i];
      const query = buildFieldQuery(field, opts.formTitle);
      const hits = await hybridSearchRefDocs({
        query,
        limit: topK,
        noRerank,
        candidatesPerLeg,
      });
      out[i] = {
        fieldId: field.fieldId,
        blocks: hits.map((h) => ({
          blockId: h.blockId,
          docId: h.docId,
          text: h.text,
          score: h.score,
        })),
      };
      done += 1;
      onProgress?.(done, opts.fields.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, opts.fields.length) }, () =>
      worker(),
    ),
  );
  return out;
}

// The retrieval query — combines the form title and the field's label so
// the embedding lives in the right neighborhood. fieldId is included
// because the IRS instructions reference specific line numbers ("Line 1a",
// "Line 11"), which helps FTS pick up the right section.
function buildFieldQuery(field: FieldInventory, formTitle: string): string {
  const linePart = parseLineNumber(field.fieldId);
  const linePhrase = linePart ? `Line ${linePart}` : "";
  return [formTitle, linePhrase, field.label].filter(Boolean).join(" — ");
}

function parseLineNumber(fieldId: string): string | null {
  const match = fieldId.match(/\.line\.([^.]+)$/);
  return match ? match[1] : null;
}
