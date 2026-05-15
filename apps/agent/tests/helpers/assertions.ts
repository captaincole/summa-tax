// Assertion primitives the runner uses to check engine + render output
// against a Scenario's ExpectedResults. All assertions append to a
// failure list rather than throwing — the runner reports all failures at
// once instead of bailing on the first one.
//
// Each helper takes an optional `prefix` (the formId) which gets prepended
// to failure messages so multi-form scenarios are unambiguous.

import type { EvaluatedForm, AnyFormField } from "../../src/mastra/engine/types.js";
import type { RenderedWidget } from "../../src/mastra/engine/render/fillFromCatalog.js";
import type { GoldenValue } from "./goldenPdf.js";
import { normalizeForCompare } from "./goldenPdf.js";

function tag(prefix: string | undefined, body: string): string {
  return prefix ? `[${prefix}] ${body}` : body;
}

export function assertEngineNumber(
  form: EvaluatedForm<AnyFormField>,
  fieldId: string,
  expected: number,
  failures: string[],
  prefix?: string,
): void {
  const f = form.fields.find((x) => x.fieldId === fieldId);
  if (!f) {
    failures.push(tag(prefix, `engine: field ${fieldId} not present in evaluated form.`));
    return;
  }
  if (!f.result.ok) {
    // `unsupported` is a deliberate engine gap, not a "needs data" block.
    // The rule library's fromFields contract treats unsupported terms as
    // 0 downstream, so semantically an unsupported field IS 0 — accept
    // it as a pass when the expected value is 0. Genuine blocked results
    // (missing facts/decisions the user needs to provide) still fail.
    if (f.result.unsupported && expected === 0) return;
    failures.push(tag(prefix, `engine: ${fieldId} blocked — ${f.result.reason}.`));
    return;
  }
  const got = f.result.value;
  // 50¢ tolerance — money lines round at render time and the table-derived
  // tax values are already integer-valued.
  if (typeof got !== "number" || Math.abs(got - expected) > 0.5) {
    failures.push(
      tag(prefix, `engine: ${fieldId} expected ${expected}, got ${String(got)}.`),
    );
  }
}

export function assertRenderedText(
  rendered: Map<string, RenderedWidget[]>,
  fieldId: string,
  expectedText: string,
  failures: string[],
  prefix?: string,
): void {
  const arr = rendered.get(fieldId);
  if (!arr || arr.length === 0) {
    failures.push(tag(prefix, `render: ${fieldId} was not written to any PDF widget.`));
    return;
  }
  const matched = arr.find((w) => w.text === expectedText);
  if (!matched) {
    failures.push(
      tag(
        prefix,
        `render: ${fieldId} expected text "${expectedText}", got ${JSON.stringify(arr.map((w) => w.text ?? `(checked ${w.widgetName})`))}.`,
      ),
    );
  }
}

export function assertNotRendered(
  rendered: Map<string, RenderedWidget[]>,
  fieldId: string,
  failures: string[],
  prefix?: string,
): void {
  if (rendered.has(fieldId)) {
    failures.push(
      tag(
        prefix,
        `render: ${fieldId} should be blank but was written (${JSON.stringify(rendered.get(fieldId))}).`,
      ),
    );
  }
}

export function assertRenderedChecked(
  rendered: Map<string, RenderedWidget[]>,
  fieldId: string,
  failures: string[],
  prefix?: string,
): void {
  const arr = rendered.get(fieldId);
  if (!arr || arr.length === 0 || !arr.some((w) => w.checked || w.text)) {
    failures.push(
      tag(
        prefix,
        `render: ${fieldId} expected at least one checked/selected widget, got ${JSON.stringify(arr ?? [])}.`,
      ),
    );
  }
}

/**
 * Diff our rendered values against a CPA-completed golden PDF, widget-by-
 * widget. This is the test layer that catches catalog mislabeling — if the
 * catalog says `first_name_mi → f1_01[0]` but f1_01[0] is actually the
 * year-begin widget, the binding writes "Alex" to f1_01[0] which doesn't
 * match the golden's "01/01/2025", and we report the mismatch.
 *
 * Comparison is per widget name (the deterministic PDF identifier), not
 * per fieldId — the catalog's labels are out of the loop entirely.
 *
 * For widgets the golden has filled and we didn't, OR widgets we filled
 * and the golden didn't, OR widgets where the values disagree — emit a
 * failure naming the widget and both values.
 */
export function assertMatchesGolden(
  rendered: Map<string, RenderedWidget[]>,
  golden: Map<string, GoldenValue>,
  failures: string[],
  prefix?: string,
): void {
  // Index our rendered output by widget name (1 row per widget actually
  // written). RenderedWidget can be `text` (text fields, dates) or
  // `checked` (checkboxes flipped on) or carry a radio-option label.
  const ours = new Map<string, string | boolean>();
  for (const [, widgets] of rendered) {
    for (const w of widgets) {
      if (typeof w.text === "string") {
        ours.set(w.widgetName, w.text);
      } else if (w.checked) {
        ours.set(w.widgetName, true);
      }
    }
  }

  const allWidgets = new Set<string>([...ours.keys(), ...golden.keys()]);
  for (const widgetName of allWidgets) {
    const g = golden.get(widgetName);
    const o = ours.get(widgetName);

    // For checkboxes + radios, our renderer writes a value only when the
    // box is "on." Golden's checkbox value is true/false explicitly.
    if (g?.kind === "checkbox") {
      const goldenChecked = g.value === true;
      const ourChecked = o === true;
      if (goldenChecked !== ourChecked) {
        failures.push(
          tag(
            prefix,
            `golden: widget ${widgetName} (checkbox) — golden=${goldenChecked} ours=${ourChecked}`,
          ),
        );
      }
      continue;
    }
    if (g?.kind === "radio") {
      const goldenSelected = normalizeForCompare(g.value);
      const ourSelected = typeof o === "string" ? normalizeForCompare(o) : "";
      if (goldenSelected !== ourSelected) {
        failures.push(
          tag(
            prefix,
            `golden: widget ${widgetName} (radio) — golden=${JSON.stringify(g.value)} ours=${JSON.stringify(o ?? null)}`,
          ),
        );
      }
      continue;
    }

    // Default: text comparison (covers text fields + widgets the golden
    // didn't classify cleanly). Empty/blank on both sides = pass. We
    // intentionally do NOT treat "0" and "" as equivalent — every numeric
    // line that computes to zero should be rendered as "0" on both sides.
    const goldenText = normalizeForCompare(g?.value);
    const ourText = typeof o === "string" ? normalizeForCompare(o) : "";
    if (goldenText !== ourText) {
      failures.push(
        tag(
          prefix,
          `golden: widget ${widgetName} — golden=${JSON.stringify(goldenText)} ours=${JSON.stringify(ourText)}`,
        ),
      );
    }
  }
}
