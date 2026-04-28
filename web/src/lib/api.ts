import { authHeaders } from "./auth";

// Vite proxies /app and /api to localhost:4111 in dev. In prod, the same
// server hosts the bundle so relative paths just work.

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
  taxpayerFirstName: string | null;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function fetchState(passcodeOverride?: string): Promise<CaseState> {
  const headers = passcodeOverride
    ? { Authorization: `Bearer ${passcodeOverride}` }
    : authHeaders();
  const res = await fetch("/app/state", { headers });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`State fetch failed: ${res.status}`);
  return res.json();
}

export async function resetSession(): Promise<void> {
  const res = await fetch("/app/session/reset", {
    method: "POST",
    headers: authHeaders(),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
}
