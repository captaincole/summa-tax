import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  recordFact,
  listFacts,
  listOpenQuestions,
  resolveQuestion,
} from "../db/taxFacts";
import { requireUserContext } from "./userContext";

const CATEGORIES = [
  "preferences",
  "identity",
  "filing_status",
  "dependents",
  "wages",
  "self_employment",
  "k1",
  "investment_income",
  "capital_gains",
  "rental",
  "retirement",
  "hsa",
  "charitable",
  "mortgage",
  "state_local_tax",
  "medical",
  "education",
  "estimated_payments",
  "crypto",
  "foreign",
  "trust_estate",
  "other",
] as const;

export const recordTaxFact = createTool({
  id: "record-tax-fact",
  description:
    "Store a confirmed tax fact for the current user/year. Only call after the user has explicitly stated or confirmed the value — never invent or guess. Always include a source_note describing where the number came from (e.g. 'W-2 Box 1 from Stripe, 2025', 'verbal confirmation during 2026-04-19 intake'). The user is identified automatically via auth — you don't need to track an id.",
  inputSchema: z.object({
    year: z.number().int().describe("Tax year (e.g. 2025)"),
    category: z.enum(CATEGORIES).describe("Fact category bucket"),
    key: z.string().describe("Short snake_case key, e.g. 'w2_box1_wages' or 'roth_ira_contribution'"),
    value: z.any().describe("The value — number, string, or object. Numbers should be in dollars unless noted."),
    sourceNote: z.string().describe("Where this came from — document, statement, or conversation"),
  }),
  outputSchema: z.object({
    id: z.string(),
    recorded: z.boolean(),
  }),
  execute: async (input, context) => {
    const { supabase, userId } = requireUserContext(context);
    const id = crypto.randomUUID();
    await recordFact(supabase, {
      id,
      userId,
      taxYear: input.year,
      category: input.category,
      key: input.key,
      value: input.value,
      sourceNote: input.sourceNote,
    });
    return { id, recorded: true };
  },
});

export const listTaxFacts = createTool({
  id: "list-tax-facts",
  description:
    "List previously recorded tax facts for the current user. Use before asking a question to avoid re-asking something already confirmed, and when preparing a summary.",
  inputSchema: z.object({
    year: z.number().int().optional(),
    category: z.enum(CATEGORIES).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  outputSchema: z.object({
    facts: z.array(
      z.object({
        id: z.string(),
        userId: z.string(),
        taxYear: z.number(),
        category: z.string(),
        key: z.string(),
        value: z.any(),
        sourceNote: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async (input, context) => {
    const { supabase } = requireUserContext(context);
    const facts = await listFacts(supabase, {
      taxYear: input.year,
      category: input.category,
      limit: input.limit,
    });
    return { facts };
  },
});

export const listOpenQuestionsTool = createTool({
  id: "list-open-questions",
  description:
    "List unresolved questions/gaps for the current user. Use at the start of a session to pick up where the last one left off, and before generating a summary.",
  inputSchema: z.object({
    status: z.enum(["open", "resolved", "all"]).optional(),
  }),
  outputSchema: z.object({
    questions: z.array(
      z.object({
        id: z.string(),
        userId: z.string(),
        status: z.string(),
        question: z.string(),
        context: z.string().nullable(),
        createdAt: z.string(),
        resolvedAt: z.string().nullable(),
      }),
    ),
  }),
  execute: async (input, ctx) => {
    const { supabase } = requireUserContext(ctx);
    const questions = await listOpenQuestions(supabase, input.status ?? "open");
    return { questions };
  },
});

export const resolveOpenQuestion = createTool({
  id: "resolve-open-question",
  description: "Mark an open question as resolved once the user has answered it and the fact has been recorded.",
  inputSchema: z.object({
    id: z.string(),
  }),
  outputSchema: z.object({
    resolved: z.boolean(),
  }),
  execute: async (input, ctx) => {
    const { supabase } = requireUserContext(ctx);
    await resolveQuestion(supabase, input.id);
    return { resolved: true };
  },
});
