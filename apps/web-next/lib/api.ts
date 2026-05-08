import { authHeaders } from "@/lib/auth";
import { agentUrl } from "@/lib/agentBase";

// Cross-origin agent calls. fetchState and fetchActivity are kept around
// for Phase 3 — they get retired in Phase 5 when their data moves to
// Server Component reads against Supabase. resetSession stays on the agent
// because it deletes Mastra threads via Memory.deleteThread (admin-pool work).

export interface CaseState {
  withinMvp: boolean;
  mvpViolations: string[];
  openAsks: { factKey: string; prompt: string; origin: string; stage: string }[];
  progress: { intakePct: number; scopingPct: number; docsPct: number; overallPct: number };
  money: {
    totalWages: number;
    agi: number;
    taxableIncome: number;
    federalTaxOwed: number;
    federalWithholding: number;
    refundOrBalance: { direction: "refund" | "balance_due" | "even"; amount: number };
  };
  factCount: number;
  decisionCount: number;
  draftUrl: string | null;
  form8949Url: string | null;
  scheduleDUrl: string | null;
  form540Url: string | null;
  sidecarUrl: string | null;
  taxpayerFirstName: string | null;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function fetchState(): Promise<CaseState> {
  const res = await fetch(agentUrl("/app/state"), { headers: await authHeaders() });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`State fetch failed: ${res.status}`);
  return res.json();
}

export type ActivityKind = "fact" | "decision";
export type Verdict = "accurate" | "inaccurate" | "ungroundable" | "review_failed";
export type Confidence = "low" | "medium" | "high";

export interface ActivityItem {
  kind: ActivityKind;
  id: string;
  createdAt: string;
  title: string;
  value: unknown;
  sourceNote: string | null;
  category?: string;
  rationale?: string;
  supportingFactKeys?: string[];
  confidence?: Confidence;
  verdict?: Verdict | null;
  verdictReason?: string | null;
}

export async function fetchActivity(limit = 50): Promise<ActivityItem[]> {
  const res = await fetch(agentUrl(`/app/activity?limit=${limit}`), {
    headers: await authHeaders(),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`Activity fetch failed: ${res.status}`);
  const json = (await res.json()) as { items: ActivityItem[] };
  return json.items;
}

export async function resetSession(): Promise<void> {
  const res = await fetch(agentUrl("/app/session/reset"), {
    method: "POST",
    headers: await authHeaders(),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
}
