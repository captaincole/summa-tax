// Vision-AI label resolver for the form-ingest pipeline.
//
// Given one PDF page's worth of widgets and the rendered page image with
// numbered overlay badges, ask Claude vision to return the human-readable
// label for each widget. Widgets that already carry a /TU value are passed
// through with `tuLabel` set — the prompt says to echo /TU verbatim and only
// infer labels for widgets where /TU is null.
//
// Single call per page. Tool-use enforces the response shape.

import Anthropic from "@anthropic-ai/sdk";
import {
  renderPageWithOverlay,
  type OverlayWidget,
} from "./renderPageWithOverlay.js";
import type { FieldKind } from "./extractFormFields.js";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4000;

export interface VisionWidget {
  /** Page-local badge number drawn on the overlay image. Must be unique within the page. */
  id: number;
  /** Full pdf-form widget name (returned in the prompt for the model's reference, not relied on). */
  fieldName: string;
  kind: FieldKind;
  rect: [number, number, number, number];
  /** Checkbox on-value (when applicable). */
  exportValue?: string;
  /** Radio-button option label (when applicable). */
  buttonValue?: string;
  /** /TU value when present. The model is instructed to echo this verbatim. */
  tuLabel: string | null;
}

export interface ResolveLabelsOpts {
  pdfPath: string;
  /** pdf.js PDFDocumentProxy. */
  pdf: any;
  pageIndex: number;
  widgets: VisionWidget[];
}

const SYSTEM_PROMPT = `You are labeling form-field widgets on a U.S. tax form. The user gives you:
  - A rendered image of one page of the form. Each form widget (text input, checkbox, radio button, etc.) is outlined with a red rectangle, and a small red badge with a number sits INSIDE that rectangle in the top-left corner.
  - A JSON table listing those widgets. Each row's \`id\` matches the badge number drawn inside its rectangle.

The numbered red rectangle IS the widget. The form text OUTSIDE the rectangle is the label — that's what you're returning.

Badges are assigned in reading order (top-to-bottom, left-to-right), so badge 1 is the top-left widget on the page and the largest badge number is at the bottom-right. This is a strong sanity check: if you find yourself wanting to label badge 5 with text that's clearly below badge 20, you have the wrong association.

Rules:
  1. If a widget has \`tu_label\` set (non-null), use that string VERBATIM as the label. Do not paraphrase, summarize, or modify it. /TU is the form author's authoritative label; we just need it echoed back.
  2. Otherwise, look at the page image, locate the badge with that id INSIDE its red rectangle, and read the nearest form text describing what that widget is for.
     - For text input fields: the label is typically to the LEFT of or ABOVE the rectangle ("Your first name and middle initial", "Total amount from Form(s) W-2, box 1", "Spouse's social security number").
     - For checkboxes / radio buttons: the label is typically to the RIGHT of the rectangle ("Single", "Married filing jointly", "Head of household").
     - For numbered tax-form lines, include the line number in the label ("Line 1a — Total amount from Form(s) W-2, box 1").
  3. Return clean natural-language labels, not the widget's neighbors verbatim. Strip OCR artifacts (stray dots, page numbers, decorative repeated headings).
  4. If you genuinely cannot determine a label from the image (e.g. the rectangle covers a decorative element), return an empty string. The pipeline will surface it as a missing-label error and route to manual review.

Return exactly one label per input widget. Use the tool exactly once.`;

export async function resolveLabelsForPage(
  opts: ResolveLabelsOpts,
): Promise<Map<number, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const overlayWidgets: OverlayWidget[] = opts.widgets.map((w) => ({
    id: w.id,
    rect: w.rect,
  }));
  const rendered = await renderPageWithOverlay({
    pdf: opts.pdf,
    pageIndex: opts.pageIndex,
    widgets: overlayWidgets,
    scale: 2,
  });

  const widgetTable = opts.widgets.map((w) => ({
    id: w.id,
    kind: w.kind,
    tu_label: w.tuLabel,
    ...(w.exportValue ? { export_value: w.exportValue } : {}),
    ...(w.buttonValue ? { button_value: w.buttonValue } : {}),
  }));

  const userText = `Form: ${opts.pdfPath}
Page index (0-based): ${opts.pageIndex}

Widgets to label (${widgetTable.length}):
${JSON.stringify(widgetTable, null, 2)}

For each widget id above, return its label. Echo \`tu_label\` verbatim when present. Otherwise read the rendered page image (attached) and infer the label from the adjacent form text.`;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "submit_labels",
        description:
          "Submit one label per widget in the input table. The label is the human-readable prompt that tells a taxpayer what value belongs in that widget.",
        input_schema: {
          type: "object",
          properties: {
            labels: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  label: { type: "string" },
                },
                required: ["id", "label"],
              },
            },
          },
          required: ["labels"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_labels" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: rendered.png.toString("base64"),
            },
          },
          {
            type: "text",
            text: userText,
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `visionLabel: no tool_use in response (stop_reason=${response.stop_reason})`,
    );
  }
  const rawInput = toolUse.input as
    | { labels?: Array<{ id: number; label: string }> | string }
    | null;
  if (rawInput && typeof rawInput.labels === "string") {
    try {
      rawInput.labels = JSON.parse(rawInput.labels);
    } catch {
      /* fall through to validation */
    }
  }
  if (!rawInput || !Array.isArray(rawInput.labels)) {
    throw new Error(
      `visionLabel: malformed tool input. Preview: ${JSON.stringify(rawInput).slice(0, 300)}`,
    );
  }

  const out = new Map<number, string>();
  for (const row of rawInput.labels) {
    if (typeof row.id === "number" && typeof row.label === "string") {
      out.set(row.id, row.label);
    }
  }
  return out;
}
