// Grounding smoke test — three end-to-end review-decision workflow runs
// against a THROWAWAY app DB (APP_DB_PATH is pointed at a temp file before
// any module loads, so the dev database is never touched; the real corpus.db
// is used read-only for retrieval).
//
// Each case: seed facts → record a decision → run reviewDecision(scope, id)
// directly (the same entry the record-ai-decision tool fires in the
// background) → assert the verdict, persistence, citations, and the
// open-question side effects.
//
// Costs real LLM calls (Haiku × a few per case) — run on demand, not in CI:
//   npm run smoke:review

import "dotenv/config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

// Point the app DB at a temp file BEFORE importing anything that opens it.
const SMOKE_DB = join(tmpdir(), `summa-smoke-${Date.now()}.db`);
process.env.APP_DB_PATH = SMOKE_DB;
process.env.MASTRA_DB_PATH = join(tmpdir(), `summa-smoke-mastra-${Date.now()}.db`);

const YEAR = 2025;
const OWNER_ID = "smoke-owner";

interface Case {
  name: string;
  /** Any of these verdicts passes. Case 3 accepts two: the CA 540 booklet is
   *  in the corpus now, so the old "ungroundable" outcome became "accurate
   *  when retrieval lands / needs_more_facts when it doesn't". */
  acceptVerdicts: Array<"accurate" | "inaccurate" | "needs_more_facts">;
  /** Should finalize have written an open_questions row? */
  expectOpenQuestion: boolean | "if-not-accurate";
  facts: Array<{ category: string; key: string; value: unknown; sourceNote: string }>;
  decision: {
    decisionKey: string;
    decision: unknown;
    rationale: string;
    supportingFactKeys: string[];
    confidence: "low" | "medium" | "high";
    dissentingConsiderations?: string;
    sourceNote: string;
  };
}

const CASES: Case[] = [
  {
    name: "accurate: filing status = single with marital fact = never_married",
    acceptVerdicts: ["accurate"],
    expectOpenQuestion: false,
    facts: [
      {
        category: "identity",
        key: "identity.marital_status",
        value: "never_married",
        sourceNote: "user stated verbally 2026-04-23",
      },
      {
        category: "identity",
        key: "identity.has_qualifying_dependents",
        value: false,
        sourceNote: "user stated verbally 2026-04-23",
      },
    ],
    decision: {
      decisionKey: "decisions.filing_status_eligibility",
      decision: { status: "single" },
      rationale:
        "User confirmed marital_status=never_married and has no qualifying dependents. Per Form 1040 filing-status rules, a never-married taxpayer with no qualifying dependents files as Single.",
      supportingFactKeys: [
        "identity.marital_status",
        "identity.has_qualifying_dependents",
      ],
      confidence: "high",
      sourceNote: "derived from intake conversation 2026-04-23",
    },
  },
  {
    name: "inaccurate: filing status = single but marital fact = married",
    acceptVerdicts: ["inaccurate"],
    expectOpenQuestion: true,
    facts: [
      {
        category: "identity",
        key: "identity.marital_status",
        value: "married",
        sourceNote: "user stated verbally 2026-04-23",
      },
    ],
    decision: {
      decisionKey: "decisions.filing_status_eligibility",
      decision: { status: "single" },
      rationale:
        "User confirmed marital_status=married but I am recording filing status as single because I got confused.",
      supportingFactKeys: ["identity.marital_status"],
      confidence: "low",
      dissentingConsiderations: "The supporting fact directly contradicts this.",
      sourceNote: "derived from intake conversation 2026-04-23",
    },
  },
  {
    // Borderline-by-design: the 540 booklet has thin residency detail (FTB
    // Pub 1031 isn't ingested), so the judge lands differently run to run
    // (accurate / needs_more_facts / inaccurate are all defensible-ish).
    // This case asserts PIPELINE MECHANICS (3-iteration loop, CA-corpus
    // retrieval, persistence, open-question side effects) — not judge
    // calibration. Calibration coverage belongs to a real eval dataset
    // (see CLAUDE.md lessons: don't tune prompts off one smoke case).
    name: "CA residency call (mechanics only — borderline verdict accepted)",
    acceptVerdicts: ["accurate", "needs_more_facts", "inaccurate"],
    expectOpenQuestion: "if-not-accurate",
    facts: [
      {
        category: "identity",
        key: "identity.residence_state",
        value: "CA",
        sourceNote: "user stated verbally 2026-04-23",
      },
      {
        category: "identity",
        key: "identity.days_outside_ca_2025",
        value: 20,
        sourceNote: "user stated verbally 2026-04-23",
      },
    ],
    decision: {
      decisionKey: "decisions.ca_residency",
      decision: "full_year_ca_resident",
      rationale:
        "User lived in CA all of 2025 except 20 days of business travel to Nevada. Under CA FTB rules, that is a full-year CA resident.",
      supportingFactKeys: [
        "identity.residence_state",
        "identity.days_outside_ca_2025",
      ],
      confidence: "high",
      sourceNote: "derived from intake conversation 2026-04-23",
    },
  },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY not set — skipping smoke test (the review workflow needs it)",
    );
    process.exit(0);
  }

  // Import AFTER the env override so every module opens the temp DB.
  const { createOwnerFiling } = await import("../src/mastra/db/filings");
  const { recordFact, listOpenQuestions } = await import("../src/mastra/db/taxFacts");
  const { recordDecision, getDecisionById } = await import("../src/mastra/db/aiDecisions");
  const { reviewDecision } = await import("../src/mastra/workflows/reviewDecision");

  console.log(`[smoke:review] temp app DB: ${SMOKE_DB}`);
  let passed = 0;

  for (const c of CASES) {
    // Fresh filing per case → clean fact/question space.
    const filingId = crypto.randomUUID();
    await createOwnerFiling({ filingId, userId: OWNER_ID, taxYear: YEAR });
    const scope = { userId: OWNER_ID, filingId };

    for (const f of c.facts) {
      await recordFact(scope, {
        id: crypto.randomUUID(),
        userId: OWNER_ID,
        filingId,
        taxYear: YEAR,
        category: f.category,
        key: f.key,
        value: f.value,
        sourceNote: f.sourceNote,
      });
    }

    const decisionId = crypto.randomUUID();
    await recordDecision(scope, {
      id: decisionId,
      userId: OWNER_ID,
      filingId,
      taxYear: YEAR,
      ...c.decision,
    });

    const t0 = Date.now();
    const result = await reviewDecision(scope, decisionId);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    const row = await getDecisionById(scope, decisionId);
    const questions = await listOpenQuestions(scope, "open");

    const passVerdict = (c.acceptVerdicts as string[]).includes(result.finalVerdict);
    const passPersist = row?.verdict === result.finalVerdict;
    const passCitations =
      result.finalVerdict !== "accurate" || result.citations.length > 0;
    const expectQ =
      c.expectOpenQuestion === "if-not-accurate"
        ? result.finalVerdict !== "accurate"
        : c.expectOpenQuestion;
    const passQuestion = expectQ
      ? questions.length > 0
      : questions.length === 0;

    const pass = passVerdict && passPersist && passCitations && passQuestion;
    if (pass) passed += 1;

    console.log(
      `${pass ? "✓" : "✗"} ${c.name} (${secs}s, ${result.iterationCount} iter)\n` +
        `    accept=[${c.acceptVerdicts.join("|")}]  got=${result.finalVerdict}` +
        (result.citations.length
          ? `\n    citations: ${result.citations.map((x) => x.blockId).join(", ")}`
          : "") +
        `\n    reason: ${result.reason.slice(0, 180)}`,
    );
    if (!passPersist) console.log(`    [!] DB verdict=${row?.verdict} ≠ workflow result`);
    if (!passCitations) console.log(`    [!] accurate verdict but no citations`);
    if (!passQuestion)
      console.log(
        `    [!] open_questions mismatch: expected ${expectQ ? ">0" : "0"}, got ${questions.length}`,
      );
  }

  // Clean up the throwaway DBs.
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(`${SMOKE_DB}${suffix}`, { force: true }).catch(() => {});
    await rm(`${process.env.MASTRA_DB_PATH}${suffix}`, { force: true }).catch(() => {});
  }

  console.log(`\n[smoke:review] ${passed}/${CASES.length} cases passed`);
  process.exit(passed === CASES.length ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke:review] failed:", err);
  process.exit(1);
});
