// Assertion primitives the runner uses to check engine + render output
// against a Scenario's ExpectedResults. All assertions append to a
// failure list rather than throwing — the runner reports all failures at
// once instead of bailing on the first one.

import type { EvaluatedForm, AnyFormField } from "../../src/mastra/forms/types.js";
import type { RenderedWidget } from "../../src/mastra/forms/render/fillForm1040.js";

export function assertEngineNumber(
  form: EvaluatedForm<AnyFormField>,
  fieldId: string,
  expected: number,
  failures: string[],
): void {
  const f = form.fields.find((x) => x.fieldId === fieldId);
  if (!f) {
    failures.push(`engine: field ${fieldId} not present in evaluated form.`);
    return;
  }
  if (!f.result.ok) {
    failures.push(`engine: ${fieldId} blocked — ${f.result.reason}.`);
    return;
  }
  const got = f.result.value;
  // 50¢ tolerance — money lines round at render time and the table-derived
  // tax values are already integer-valued.
  if (typeof got !== "number" || Math.abs(got - expected) > 0.5) {
    failures.push(`engine: ${fieldId} expected ${expected}, got ${String(got)}.`);
  }
}

export function assertRenderedText(
  rendered: Map<string, RenderedWidget[]>,
  fieldId: string,
  expectedText: string,
  failures: string[],
): void {
  const arr = rendered.get(fieldId);
  if (!arr || arr.length === 0) {
    failures.push(`render: ${fieldId} was not written to any PDF widget.`);
    return;
  }
  const matched = arr.find((w) => w.text === expectedText);
  if (!matched) {
    failures.push(
      `render: ${fieldId} expected text "${expectedText}", got ${JSON.stringify(arr.map((w) => w.text ?? `(checked ${w.widgetName})`))}.`,
    );
  }
}

export function assertNotRendered(
  rendered: Map<string, RenderedWidget[]>,
  fieldId: string,
  failures: string[],
): void {
  if (rendered.has(fieldId)) {
    failures.push(
      `render: ${fieldId} should be blank but was written (${JSON.stringify(rendered.get(fieldId))}).`,
    );
  }
}

export function assertRenderedChecked(
  rendered: Map<string, RenderedWidget[]>,
  fieldId: string,
  failures: string[],
): void {
  const arr = rendered.get(fieldId);
  if (!arr || arr.length === 0 || !arr.some((w) => w.checked)) {
    failures.push(
      `render: ${fieldId} expected at least one checked widget, got ${JSON.stringify(arr ?? [])}.`,
    );
  }
}
