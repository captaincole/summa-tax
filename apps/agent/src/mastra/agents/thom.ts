import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import { pgPool } from "../server/storage";
import {
  recordTaxFact,
  noteOpenQuestion,
  listOpenQuestionsTool,
  resolveOpenQuestion,
} from "../tools/taxFacts";
import { getCaseState } from "../tools/caseState";
import { ingestW2 } from "../tools/ingestW2";
import { ingest1099Consolidated } from "../tools/ingest1099Consolidated";
import { recordAIDecision, listAIDecisions } from "../tools/aiDecisions";
import { generateTaxDocuments } from "../tools/generateTaxDocuments";
import { thomInstructions } from "./thom.instructions";

export const thom = new Agent({
  id: "thom",
  name: "Thom Merrilin",
  instructions: thomInstructions,
  model: "anthropic/claude-sonnet-4-6",
  // Multi-step: get-case-state + maybe one ingest + a record-ai-decision +
  // optionally generate-tax-documents = ~5 steps per turn. 20 leaves headroom
  // for batched scope decisions on a single turn.
  defaultOptions: { maxSteps: 20 },
  defaultGenerateOptionsLegacy: { maxSteps: 20 },
  defaultStreamOptionsLegacy: { maxSteps: 20 },
  tools: {
    // Primary tools Thom uses every turn
    getCaseState,
    ingestW2,
    ingest1099Consolidated,
    recordTaxFact,
    noteOpenQuestion,
    recordAIDecision,
    // End-of-session artifact generation
    generateTaxDocuments,
    // Secondary — for follow-up
    listOpenQuestions: listOpenQuestionsTool,
    resolveOpenQuestion,
    listAIDecisions,
  },
  memory: new Memory({
    storage: new PostgresStore({
      id: "thom-memory",
      pool: pgPool,
      schemaName: "mastra",
      // Schema migrations run during build via `npm run migrate:mastra`.
      // See server/storage.ts for the full reasoning.
      disableInit: true,
    }),
  }),
});
