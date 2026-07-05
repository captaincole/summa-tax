import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { mastraDbUrl } from "../server/storage";
import {
  recordTaxFact,
  listOpenQuestionsTool,
  resolveOpenQuestion,
} from "../tools/taxFacts";
import { getCaseState } from "../tools/caseState";
import { ingestW2 } from "../tools/ingestW2";
import { ingest1099Consolidated } from "../tools/ingest1099Consolidated";
import { recordAIDecision, listAIDecisions } from "../tools/aiDecisions";
import { generateTaxDocuments } from "../tools/generateTaxDocuments";
import { requestDocumentUpload } from "../tools/requestDocument";
import { dismissRequestedAction } from "../tools/dismissRequestedAction";
import { lucaInstructions } from "./luca.instructions";
import { lucaWorkingMemorySchema } from "./luca.workingMemory";

export const luca = new Agent({
  id: "luca",
  name: "Luca",
  instructions: lucaInstructions,
  model: "anthropic/claude-sonnet-4-6",
  // Multi-step: get-case-state + maybe one ingest + a record-ai-decision +
  // optionally generate-tax-documents = ~5 steps per turn. 20 leaves headroom
  // for batched scope decisions on a single turn.
  defaultOptions: { maxSteps: 20 },
  defaultGenerateOptionsLegacy: { maxSteps: 20 },
  defaultStreamOptionsLegacy: { maxSteps: 20 },
  tools: {
    // Primary tools Luca uses every turn
    getCaseState,
    ingestW2,
    ingest1099Consolidated,
    recordTaxFact,
    recordAIDecision,
    // Surface specific document requests to the dashboard as action cards.
    requestDocumentUpload,
    // Close a card after successful ingest of the uploaded document.
    dismissRequestedAction,
    // End-of-session artifact generation
    generateTaxDocuments,
    // Secondary — listOpenQuestions/resolveOpenQuestion remain so Luca can
    // see and clear rows that the review workflow writes. He no longer
    // authors his own open questions — that lives in working memory now.
    listOpenQuestions: listOpenQuestionsTool,
    resolveOpenQuestion,
    listAIDecisions,
  },
  memory: new Memory({
    // Same mastra.db file as the main runtime store — separate store
    // instance because Memory owns its storage lifecycle, same database
    // because threads/messages belong with the rest of the runtime state.
    storage: new LibSQLStore({
      id: "luca-memory",
      url: mastraDbUrl(),
    }),
    options: {
      // Thread-scoped because we currently run a single demo thread per user.
      // Switch to "resource" once we split per tax year (2025 / 2026 / …).
      // Mastra auto-registers updateWorkingMemory as a tool; the schema
      // shape is documented in luca.workingMemory.ts.
      workingMemory: {
        enabled: true,
        scope: "thread",
        schema: lucaWorkingMemorySchema,
      },
    },
  }),
});
