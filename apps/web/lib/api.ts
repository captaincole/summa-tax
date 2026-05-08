import { authHeaders } from "@/lib/auth";
import { agentUrl } from "@/lib/agentBase";

// Cross-origin agent calls. fetchState stays here for now — it runs the
// case engine on the agent side, which we're not extracting in this
// migration (see follow-up on /app/state in CLAUDE.md). resetSession also
// stays because it deletes Mastra threads via Memory.deleteThread (admin-
// pool work).
//
// fetchActivity moved to lib/activity.ts (direct Supabase reads) — both
// the chat right rail and /activity page consume it.

export type PlanItemStatus = "todo" | "doing" | "done";

export interface PlanItem {
  id: string;
  title: string;
  status: PlanItemStatus;
  note?: string;
}

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
  plan: PlanItem[];
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

export async function resetSession(): Promise<void> {
  const res = await fetch(agentUrl("/app/session/reset"), {
    method: "POST",
    headers: await authHeaders(),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
}
