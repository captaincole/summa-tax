import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  recordFact,
  listFacts,
  noteQuestion,
  listOpenQuestions,
  resolveQuestion,
} from "../db/taxFacts";

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
    "Store a confirmed tax fact for a taxpayer/year. Only call after the taxpayer has explicitly stated or confirmed the value — never invent or guess. Always include a source_note describing where the number came from (e.g. 'W-2 Box 1 from Stripe, 2025', 'verbal confirmation during 2026-04-19 intake').",
  inputSchema: z.object({
    taxpayerId: z.string().describe("Stable id for the taxpayer (e.g. email or uuid)"),
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
  execute: async (input) => {
    const id = crypto.randomUUID();
    await recordFact({
      id,
      taxpayerId: input.taxpayerId,
      year: input.year,
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
    "List previously recorded tax facts for a taxpayer. Use this before asking a question to avoid re-asking something already confirmed, and when preparing a summary.",
  inputSchema: z.object({
    taxpayerId: z.string(),
    year: z.number().int().optional(),
    category: z.enum(CATEGORIES).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  outputSchema: z.object({
    facts: z.array(
      z.object({
        id: z.string(),
        taxpayerId: z.string(),
        year: z.number(),
        category: z.string(),
        key: z.string(),
        value: z.any(),
        sourceNote: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async (input) => {
    const facts = await listFacts(input);
    return { facts };
  },
});

export const noteOpenQuestion = createTool({
  id: "note-open-question",
  description:
    "Record a question or gap that still needs to be resolved — e.g. missing document, unclear residency, ambiguous K-1 number. Use this whenever you notice you cannot proceed until the taxpayer provides more info.",
  inputSchema: z.object({
    taxpayerId: z.string(),
    question: z.string().describe("The question or missing piece, phrased so someone reading later knows exactly what's needed"),
    context: z
      .string()
      .optional()
      .describe("Why this matters or what prompted the question"),
  }),
  outputSchema: z.object({
    id: z.string(),
    noted: z.boolean(),
  }),
  execute: async (input) => {
    const id = crypto.randomUUID();
    await noteQuestion({
      id,
      taxpayerId: input.taxpayerId,
      question: input.question,
      context: input.context,
    });
    return { id, noted: true };
  },
});

export const listOpenQuestionsTool = createTool({
  id: "list-open-questions",
  description:
    "List unresolved questions/gaps for a taxpayer. Use at the start of a session to pick up where the last one left off, and before generating a summary.",
  inputSchema: z.object({
    taxpayerId: z.string(),
    status: z.enum(["open", "resolved", "all"]).optional(),
  }),
  outputSchema: z.object({
    questions: z.array(
      z.object({
        id: z.string(),
        taxpayerId: z.string(),
        status: z.string(),
        question: z.string(),
        context: z.string().nullable(),
        createdAt: z.string(),
        resolvedAt: z.string().nullable(),
      }),
    ),
  }),
  execute: async (input) => {
    const questions = await listOpenQuestions(input.taxpayerId, input.status ?? "open");
    return { questions };
  },
});

export const resolveOpenQuestion = createTool({
  id: "resolve-open-question",
  description: "Mark an open question as resolved once the taxpayer has answered it and the fact has been recorded.",
  inputSchema: z.object({
    id: z.string(),
  }),
  outputSchema: z.object({
    resolved: z.boolean(),
  }),
  execute: async (input) => {
    await resolveQuestion(input.id);
    return { resolved: true };
  },
});
