import { z } from "zod";

// ---------------------------------------------------------------------------
// Building blocks shared across the workflow
// ---------------------------------------------------------------------------

export const authorityCitationSchema = z.object({
  blockId: z.string(),
  quote: z.string().optional(),
});

export const taxFactSnapshotSchema = z.object({
  key: z.string(),
  category: z.string(),
  value: z.unknown(),
  sourceNote: z.string().nullable(),
});

export const irsBlockSnapshotSchema = z.object({
  blockId: z.string(),
  docId: z.string(),
  text: z.string(),
  // Score from the retrieval call (rerank-2.5 if available, else best-of-leg
  // similarity). Persisted so future evals can compare retrieval strategies.
  score: z.number().optional(),
});

export const evidenceBundleSchema = z.object({
  facts: z.array(taxFactSnapshotSchema),
  irsBlocks: z.array(irsBlockSnapshotSchema),
  queriesUsed: z.array(z.string()),
  iteration: z.number().int().min(1).max(3),
});
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

// ---------------------------------------------------------------------------
// assessRisk output
// ---------------------------------------------------------------------------

export const riskTierSchema = z.enum(["low", "medium", "high"]);
export type RiskTier = z.infer<typeof riskTierSchema>;

export const riskAssessmentSchema = z.object({
  riskTier: riskTierSchema,
  rationale: z
    .string()
    .describe(
      "Why this tier — refer to specific facts and the consequence if the decision is wrong.",
    ),
  consequenceNotes: z
    .string()
    .describe(
      "What the downstream impact looks like if this decision is wrong (e.g. wrong state-of-residence => owe state tax in two states; wrong filing status => bracket and standard-deduction wrong).",
    ),
  dissentingConsiderations: z
    .array(z.string())
    .describe(
      "Things that could push this risk higher (or change the tier) that the assessor noticed but didn't have evidence to act on.",
    ),
});
export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;

// ---------------------------------------------------------------------------
// rule output — discriminated union on `kind`.
// ---------------------------------------------------------------------------

export const verdictSchema = z.enum([
  "accurate",
  "inaccurate",
  "needs_more_facts",
]);
export type WorkflowVerdict = z.infer<typeof verdictSchema>;

export const ruleVerdictOutputSchema = z.object({
  kind: z.literal("verdict"),
  verdict: verdictSchema,
  reason: z.string(),
  citations: z.array(authorityCitationSchema),
});

export const ruleNeedMoreOutputSchema = z.object({
  kind: z.literal("need_more_evidence"),
  reason: z
    .string()
    .describe("Why current evidence is insufficient for this risk tier."),
  suggestedQueries: z
    .array(z.string())
    .min(1)
    .describe(
      "Search-ref-docs queries to run on the next iteration — phrased the way a tax professional would describe the gap.",
    ),
});

export const ruleOutputSchema = z.discriminatedUnion("kind", [
  ruleVerdictOutputSchema,
  ruleNeedMoreOutputSchema,
]);
export type RuleOutput = z.infer<typeof ruleOutputSchema>;

// ---------------------------------------------------------------------------
// Loop carrier — the shared shape that flows through gather → assess → rule
// on every iteration. Each step takes this in and returns this out, with one
// or more fields populated. `inputSchema === outputSchema` is what makes the
// child workflow legal as a `.dountil()` step.
// ---------------------------------------------------------------------------

export const loopCarrierSchema = z.object({
  // Set once by the init step; immutable across iterations.
  decisionId: z.string(),
  reviewRunId: z.string(),
  userId: z.string(),
  taxYear: z.number().int(),
  decisionKey: z.string(),
  decisionValue: z.unknown(),
  rationale: z.string(),
  confidence: z.string(),
  dissentingConsiderationsInput: z.string().nullable(),
  supportingFactKeys: z.array(z.string()),

  // Iteration state — bumped by rule when emitting need_more_evidence.
  iteration: z.number().int().min(1).max(3),
  queries: z.array(z.string()),

  // Reasons accumulated across iterations when rule kicks back to gather.
  // Used by finalize to synthesize the whatsMissing summary if we hit
  // iteration 3 without converging.
  needMoreReasons: z.array(z.string()),

  // Populated by gather/assess/rule respectively. Optional because at the
  // start of each iteration they're freshly produced.
  evidence: evidenceBundleSchema.optional(),
  riskAssessment: riskAssessmentSchema.optional(),
  ruleOutput: ruleOutputSchema.optional(),
});
export type LoopCarrier = z.infer<typeof loopCarrierSchema>;

// ---------------------------------------------------------------------------
// Workflow terminal output
// ---------------------------------------------------------------------------

export const reviewDecisionOutputSchema = z.object({
  decisionId: z.string(),
  reviewRunId: z.string(),
  iterationCount: z.number().int().min(1).max(3),
  riskTier: riskTierSchema.nullable(),
  finalVerdict: z.enum([
    "accurate",
    "inaccurate",
    "needs_more_facts",
    "review_failed",
  ]),
  reason: z.string(),
  citations: z.array(authorityCitationSchema),
  // Populated only when finalVerdict === 'needs_more_facts':
  openQuestionId: z.string().optional(),
  whatsMissing: z.string().optional(),
});
export type ReviewDecisionOutput = z.infer<typeof reviewDecisionOutputSchema>;
