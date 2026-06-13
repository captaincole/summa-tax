import { z } from "zod";

// Luca's working memory — a thread-scoped, schema-typed scratchpad that
// Mastra surfaces in the system prompt every turn and exposes via the
// auto-registered `updateWorkingMemory` tool. The shape is read by the web
// PlanCard via /app/state, so the field names here are part of the public
// contract with the frontend.
//
// Mastra merge semantics (per the docs): top-level object fields are deep
// merged, but ARRAYS are replaced wholesale. So when Luca updates the plan
// he emits the full plan array each time.

export const planItemStatus = z.enum(["todo", "doing", "done"]);
export type PlanItemStatus = z.infer<typeof planItemStatus>;

export const planItemSchema = z.object({
  id: z
    .string()
    .describe(
      "Stable id for this step — keep the same id across status changes so the UI can animate transitions",
    ),
  title: z
    .string()
    .describe(
      "What Luca is doing in plain language, e.g. 'Capture W-2 box 1 wages' or 'Confirm CA full-year residency'. Premium-feeling phrasing — short, specific, taxpayer-readable.",
    ),
  status: planItemStatus.describe(
    "todo = not yet started, doing = currently working on, done = finished",
  ),
  note: z
    .string()
    .optional()
    .describe(
      "Optional one-liner — what's blocking it, what we're waiting on, or why this is next",
    ),
});
export type PlanItem = z.infer<typeof planItemSchema>;

export const lucaWorkingMemorySchema = z.object({
  plan: z
    .array(planItemSchema)
    .optional()
    .describe(
      "Rolling 1–5 item plan of Luca's next steps. Empty/absent when there's genuinely nothing in flight.",
    ),
});
export type LucaWorkingMemory = z.infer<typeof lucaWorkingMemorySchema>;
