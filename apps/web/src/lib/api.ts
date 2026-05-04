import { authHeaders } from "./auth";
import { apiUrl } from "./apiBase";

// In dev, Vite proxies /app and /api to localhost:4111. In prod the frontend
// is on Vercel and the backend on Render — apiUrl() prefixes the configured
// VITE_API_URL so requests cross-origin to the right host.

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
  const res = await fetch(apiUrl("/app/state"), { headers: await authHeaders() });
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
  // facts only
  category?: string;
  // decisions only
  rationale?: string;
  supportingFactKeys?: string[];
  confidence?: Confidence;
  verdict?: Verdict | null;
  verdictReason?: string | null;
}

export async function fetchActivity(limit = 50): Promise<ActivityItem[]> {
  const res = await fetch(apiUrl(`/app/activity?limit=${limit}`), { headers: await authHeaders() });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`Activity fetch failed: ${res.status}`);
  const json = (await res.json()) as { items: ActivityItem[] };
  return json.items;
}

export async function resetSession(): Promise<void> {
  const res = await fetch(apiUrl("/app/session/reset"), {
    method: "POST",
    headers: await authHeaders(),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
}
