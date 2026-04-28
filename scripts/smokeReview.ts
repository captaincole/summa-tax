import "dotenv/config";
import { recordFact } from "../src/mastra/db/taxFacts";
import { getDecisionById } from "../src/mastra/db/aiDecisions";
import { recordAIDecision } from "../src/mastra/tools/aiDecisions";

type Case = {
  name: string;
  expectedVerdict: "accurate" | "inaccurate" | "ungroundable";
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
};

const YEAR = 2025;

const CASES: Case[] = [
  {
    name: "accurate: filing status = single with marital fact = single",
    expectedVerdict: "accurate",
    facts: [
      {
        category: "identity",
        key: "identity.marital_status",
        value: "single",
        sourceNote: "user stated verbally 2026-04-23",
      },
    ],
    decision: {
      decisionKey: "decisions.filing_status_eligibility",
      decision: { status: "single" },
      rationale:
        "User confirmed marital_status=single and has no qualifying dependents. Single is the only filing status that fits per Form 1040 filing-status rules.",
      supportingFactKeys: ["identity.marital_status"],
      confidence: "high",
      sourceNote: "derived from intake conversation 2026-04-23",
    },
  },
  {
    name: "inaccurate: filing status = single but marital fact = married",
    expectedVerdict: "inaccurate",
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
    name: "ungroundable: CA-specific residency call (not in federal 1040 corpus)",
    expectedVerdict: "ungroundable",
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

async function seed(taxpayerId: string, facts: Case["facts"]) {
  for (const f of facts) {
    await recordFact({
      id: crypto.randomUUID(),
      taxpayerId,
      year: YEAR,
      category: f.category,
      key: f.key,
      value: f.value,
      sourceNote: f.sourceNote,
    });
  }
}

async function runCase(c: Case): Promise<boolean> {
  const taxpayerId = `smoke-${crypto.randomUUID().slice(0, 8)}`;
  await seed(taxpayerId, c.facts);

  const result = await (recordAIDecision as any).execute({
    taxpayerId,
    year: YEAR,
    ...c.decision,
  });

  const row = await getDecisionById(result.id);
  const passVerdict = result.verdict === c.expectedVerdict;
  const passPersist = row?.verdict === result.verdict;
  const passCitationsIfAccurate =
    c.expectedVerdict !== "accurate" ||
    (Array.isArray(result.authorityCitations) &&
      result.authorityCitations.length > 0);

  const pass = passVerdict && passPersist && passCitationsIfAccurate;
  const mark = pass ? "✓" : "✗";
  console.log(
    `${mark} ${c.name}\n    expected=${c.expectedVerdict}  got=${result.verdict}` +
      (result.authorityCitations?.length
        ? `\n    citations: ${result.authorityCitations.map((c: any) => c.blockId).join(", ")}`
        : "") +
      `\n    reason: ${String(result.verdictReason).slice(0, 200)}`,
  );
  if (!passPersist) {
    console.log(`    [!] DB row verdict=${row?.verdict} doesn't match tool response`);
  }
  if (!passCitationsIfAccurate) {
    console.log(`    [!] accurate verdict but no citations returned`);
  }
  return pass;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set — skipping smoke test (Nynaeve needs it)");
    process.exit(0);
  }
  let passed = 0;
  for (const c of CASES) {
    const ok = await runCase(c);
    if (ok) passed += 1;
  }
  console.log(`\n${passed}/${CASES.length} cases passed`);
  process.exit(passed === CASES.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
