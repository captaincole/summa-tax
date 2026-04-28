import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.DATABASE_URL ?? "file:./wheel-of-time.db",
});

let ready: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS ai_decisions (
          id TEXT PRIMARY KEY,
          taxpayer_id TEXT NOT NULL,
          year INTEGER NOT NULL,
          decision_key TEXT NOT NULL,
          decision_json TEXT NOT NULL,
          rationale TEXT NOT NULL,
          supporting_fact_keys_json TEXT NOT NULL,
          confidence TEXT NOT NULL,
          dissenting_considerations TEXT,
          authority_citations_json TEXT,
          source_note TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_ai_decisions_taxpayer_year ON ai_decisions(taxpayer_id, year)`,
      );
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_ai_decisions_key ON ai_decisions(decision_key)`,
      );

      // Verdict columns added after initial schema; add if missing.
      const cols = await client.execute(`PRAGMA table_info(ai_decisions)`);
      const names = new Set(cols.rows.map((r) => String(r.name)));
      if (!names.has("verdict")) {
        await client.execute(`ALTER TABLE ai_decisions ADD COLUMN verdict TEXT`);
      }
      if (!names.has("verdict_reason")) {
        await client.execute(
          `ALTER TABLE ai_decisions ADD COLUMN verdict_reason TEXT`,
        );
      }
      if (!names.has("verdict_at")) {
        await client.execute(
          `ALTER TABLE ai_decisions ADD COLUMN verdict_at INTEGER`,
        );
      }
    })();
  }
  return ready;
}

export type Confidence = "low" | "medium" | "high";

export type Verdict = "accurate" | "inaccurate" | "ungroundable" | "review_failed";

export interface AuthorityCitation {
  blockId: string;
  quote?: string;
}

export interface AIDecision {
  id: string;
  taxpayerId: string;
  year: number;
  decisionKey: string;
  decision: unknown;
  rationale: string;
  supportingFactKeys: string[];
  confidence: Confidence;
  dissentingConsiderations?: string;
  authorityCitations?: AuthorityCitation[];
  sourceNote?: string;
}

export interface AIDecisionRow {
  id: string;
  taxpayerId: string;
  year: number;
  decisionKey: string;
  decision: unknown;
  rationale: string;
  supportingFactKeys: string[];
  confidence: Confidence;
  dissentingConsiderations: string | null;
  authorityCitations: AuthorityCitation[] | null;
  sourceNote: string | null;
  createdAt: string;
  verdict: Verdict | null;
  verdictReason: string | null;
  verdictAt: string | null;
}

export async function recordDecision(d: AIDecision): Promise<void> {
  await ensureSchema();
  await client.execute({
    sql: `INSERT INTO ai_decisions
          (id, taxpayer_id, year, decision_key, decision_json, rationale,
           supporting_fact_keys_json, confidence, dissenting_considerations,
           authority_citations_json, source_note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      d.id,
      d.taxpayerId,
      d.year,
      d.decisionKey,
      JSON.stringify(d.decision),
      d.rationale,
      JSON.stringify(d.supportingFactKeys),
      d.confidence,
      d.dissentingConsiderations ?? null,
      d.authorityCitations ? JSON.stringify(d.authorityCitations) : null,
      d.sourceNote ?? null,
      Date.now(),
    ],
  });
}

export interface ListDecisionsOpts {
  taxpayerId: string;
  year?: number;
  decisionKey?: string;
  limit?: number;
}

export async function listDecisions(
  opts: ListDecisionsOpts,
): Promise<AIDecisionRow[]> {
  await ensureSchema();
  const where: string[] = ["taxpayer_id = ?"];
  const args: (string | number)[] = [opts.taxpayerId];
  if (opts.year !== undefined) {
    where.push("year = ?");
    args.push(opts.year);
  }
  if (opts.decisionKey) {
    where.push("decision_key = ?");
    args.push(opts.decisionKey);
  }
  const limit = Math.min(opts.limit ?? 100, 500);
  const result = await client.execute({
    sql: `SELECT id, taxpayer_id, year, decision_key, decision_json, rationale,
                 supporting_fact_keys_json, confidence, dissenting_considerations,
                 authority_citations_json, source_note, created_at,
                 verdict, verdict_reason, verdict_at
          FROM ai_decisions WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC LIMIT ?`,
    args: [...args, limit],
  });
  return result.rows.map(rowToDecision);
}

function rowToDecision(r: Record<string, unknown>): AIDecisionRow {
  return {
    id: String(r.id),
    taxpayerId: String(r.taxpayer_id),
    year: Number(r.year),
    decisionKey: String(r.decision_key),
    decision: JSON.parse(String(r.decision_json)),
    rationale: String(r.rationale),
    supportingFactKeys: JSON.parse(String(r.supporting_fact_keys_json)),
    confidence: String(r.confidence) as Confidence,
    dissentingConsiderations:
      r.dissenting_considerations == null
        ? null
        : String(r.dissenting_considerations),
    authorityCitations:
      r.authority_citations_json == null
        ? null
        : (JSON.parse(String(r.authority_citations_json)) as AuthorityCitation[]),
    sourceNote: r.source_note == null ? null : String(r.source_note),
    createdAt: new Date(Number(r.created_at)).toISOString(),
    verdict: r.verdict == null ? null : (String(r.verdict) as Verdict),
    verdictReason: r.verdict_reason == null ? null : String(r.verdict_reason),
    verdictAt:
      r.verdict_at == null ? null : new Date(Number(r.verdict_at)).toISOString(),
  };
}

export async function getDecisionById(
  id: string,
): Promise<AIDecisionRow | null> {
  await ensureSchema();
  const r = await client.execute({
    sql: `SELECT id, taxpayer_id, year, decision_key, decision_json, rationale,
                 supporting_fact_keys_json, confidence, dissenting_considerations,
                 authority_citations_json, source_note, created_at,
                 verdict, verdict_reason, verdict_at
          FROM ai_decisions WHERE id = ?`,
    args: [id],
  });
  if (r.rows.length === 0) return null;
  return rowToDecision(r.rows[0] as Record<string, unknown>);
}

export async function setDecisionVerdict(
  id: string,
  verdict: Verdict,
  reason: string,
  citations: AuthorityCitation[] | null,
): Promise<void> {
  await ensureSchema();
  await client.execute({
    sql: `UPDATE ai_decisions
          SET verdict = ?, verdict_reason = ?, verdict_at = ?,
              authority_citations_json = ?
          WHERE id = ?`,
    args: [
      verdict,
      reason,
      Date.now(),
      citations ? JSON.stringify(citations) : null,
      id,
    ],
  });
}
