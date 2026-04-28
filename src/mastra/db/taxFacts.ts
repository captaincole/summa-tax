import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.DATABASE_URL ?? "file:./wheel-of-time.db",
});

let ready: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS tax_facts (
          id TEXT PRIMARY KEY,
          taxpayer_id TEXT NOT NULL,
          year INTEGER NOT NULL,
          category TEXT NOT NULL,
          fact_key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          source_note TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_tax_facts_taxpayer_year ON tax_facts(taxpayer_id, year)`,
      );
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_tax_facts_category ON tax_facts(category)`,
      );

      await client.execute(`
        CREATE TABLE IF NOT EXISTS open_questions (
          id TEXT PRIMARY KEY,
          taxpayer_id TEXT NOT NULL,
          status TEXT NOT NULL,
          question TEXT NOT NULL,
          context TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        )
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_open_questions_taxpayer ON open_questions(taxpayer_id, status)`,
      );
    })();
  }
  return ready;
}

export interface TaxFact {
  id: string;
  taxpayerId: string;
  year: number;
  category: string;
  key: string;
  value: unknown;
  sourceNote?: string;
}

export interface TaxFactRow {
  id: string;
  taxpayerId: string;
  year: number;
  category: string;
  key: string;
  value: unknown;
  sourceNote: string | null;
  createdAt: string;
}

export async function recordFact(fact: TaxFact): Promise<void> {
  await ensureSchema();
  await client.execute({
    sql: `INSERT INTO tax_facts
          (id, taxpayer_id, year, category, fact_key, value_json, source_note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      fact.id,
      fact.taxpayerId,
      fact.year,
      fact.category,
      fact.key,
      JSON.stringify(fact.value),
      fact.sourceNote ?? null,
      Date.now(),
    ],
  });
}

export interface ListFactsOpts {
  taxpayerId: string;
  year?: number;
  category?: string;
  limit?: number;
}

export async function listFacts(opts: ListFactsOpts): Promise<TaxFactRow[]> {
  await ensureSchema();
  const where: string[] = ["taxpayer_id = ?"];
  const args: (string | number)[] = [opts.taxpayerId];
  if (opts.year !== undefined) {
    where.push("year = ?");
    args.push(opts.year);
  }
  if (opts.category) {
    where.push("category = ?");
    args.push(opts.category);
  }
  const limit = Math.min(opts.limit ?? 100, 500);
  const result = await client.execute({
    sql: `SELECT id, taxpayer_id, year, category, fact_key, value_json, source_note, created_at
          FROM tax_facts WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC LIMIT ?`,
    args: [...args, limit],
  });
  return result.rows.map((r) => ({
    id: String(r.id),
    taxpayerId: String(r.taxpayer_id),
    year: Number(r.year),
    category: String(r.category),
    key: String(r.fact_key),
    value: JSON.parse(String(r.value_json)),
    sourceNote: r.source_note == null ? null : String(r.source_note),
    createdAt: new Date(Number(r.created_at)).toISOString(),
  }));
}

export async function listFactsByKeys(
  taxpayerId: string,
  year: number,
  keys: string[],
): Promise<TaxFactRow[]> {
  if (keys.length === 0) return [];
  await ensureSchema();
  const placeholders = keys.map(() => "?").join(", ");
  const result = await client.execute({
    sql: `SELECT id, taxpayer_id, year, category, fact_key, value_json, source_note, created_at
          FROM tax_facts
          WHERE taxpayer_id = ? AND year = ? AND fact_key IN (${placeholders})
          ORDER BY created_at DESC`,
    args: [taxpayerId, year, ...keys],
  });
  // tax_facts is append-only; collapse to the latest row per fact_key.
  const latest = new Map<string, TaxFactRow>();
  for (const r of result.rows) {
    const key = String(r.fact_key);
    if (latest.has(key)) continue;
    latest.set(key, {
      id: String(r.id),
      taxpayerId: String(r.taxpayer_id),
      year: Number(r.year),
      category: String(r.category),
      key,
      value: JSON.parse(String(r.value_json)),
      sourceNote: r.source_note == null ? null : String(r.source_note),
      createdAt: new Date(Number(r.created_at)).toISOString(),
    });
  }
  return Array.from(latest.values());
}

export interface OpenQuestion {
  id: string;
  taxpayerId: string;
  question: string;
  context?: string;
}

export async function noteQuestion(q: OpenQuestion): Promise<void> {
  await ensureSchema();
  await client.execute({
    sql: `INSERT INTO open_questions
          (id, taxpayer_id, status, question, context, created_at)
          VALUES (?, ?, 'open', ?, ?, ?)`,
    args: [q.id, q.taxpayerId, q.question, q.context ?? null, Date.now()],
  });
}

export interface OpenQuestionRow {
  id: string;
  taxpayerId: string;
  status: string;
  question: string;
  context: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export async function listOpenQuestions(
  taxpayerId: string,
  status: "open" | "resolved" | "all" = "open",
): Promise<OpenQuestionRow[]> {
  await ensureSchema();
  const where: string[] = ["taxpayer_id = ?"];
  const args: (string | number)[] = [taxpayerId];
  if (status !== "all") {
    where.push("status = ?");
    args.push(status);
  }
  const result = await client.execute({
    sql: `SELECT id, taxpayer_id, status, question, context, created_at, resolved_at
          FROM open_questions WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC LIMIT 200`,
    args,
  });
  return result.rows.map((r) => ({
    id: String(r.id),
    taxpayerId: String(r.taxpayer_id),
    status: String(r.status),
    question: String(r.question),
    context: r.context == null ? null : String(r.context),
    createdAt: new Date(Number(r.created_at)).toISOString(),
    resolvedAt:
      r.resolved_at == null
        ? null
        : new Date(Number(r.resolved_at)).toISOString(),
  }));
}

export async function resolveQuestion(id: string): Promise<void> {
  await ensureSchema();
  await client.execute({
    sql: `UPDATE open_questions SET status='resolved', resolved_at=? WHERE id=?`,
    args: [Date.now(), id],
  });
}
