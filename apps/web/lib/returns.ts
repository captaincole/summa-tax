// Returns helper. For Phase 1 the list is hardcoded — one real return
// (2025) with full data wiring, plus placeholders so the multi-return UX
// reads as real. When we add a `returns` Supabase table, swap this for a
// query and keep the same exported shape.
//
// `realDataAvailable` is the switch every consumer reads. For non-real
// returns we skip the /app/state fetch, skip the activity query, and
// render empty placeholder states — no fake data structs flowing through
// real components.

export type ReturnState = "active" | "empty" | "filed";

export interface TaxReturn {
  id: string;
  year: number;
  label: string;
  state: ReturnState;
  // True only for returns wired to real Supabase / Mastra data.
  realDataAvailable: boolean;
  // Optional read-only metadata for filed returns.
  filedOn?: string;
  outcome?: string;
  outcomePositive?: boolean;
}

export const RETURNS: TaxReturn[] = [
  {
    id: "2025",
    year: 2025,
    label: "2025 Return",
    state: "active",
    realDataAvailable: true,
  },
  {
    id: "2024-amend",
    year: 2024,
    label: "2024 Amend",
    state: "empty",
    realDataAvailable: false,
  },
  {
    id: "2023",
    year: 2023,
    label: "2023 Return",
    state: "filed",
    realDataAvailable: false,
    filedOn: "Mar 12, 2024",
    outcome: "Refund $4,210",
    outcomePositive: true,
  },
  {
    id: "2022",
    year: 2022,
    label: "2022 Return",
    state: "filed",
    realDataAvailable: false,
    filedOn: "Mar 28, 2023",
    outcome: "Owed $1,400",
    outcomePositive: false,
  },
];

export const DEFAULT_RETURN_ID = "2025";

export function getReturnById(id: string): TaxReturn | undefined {
  return RETURNS.find((r) => r.id === id);
}

export function getDefaultReturn(): TaxReturn {
  const real = getReturnById(DEFAULT_RETURN_ID);
  if (!real) throw new Error("Default return missing from RETURNS list");
  return real;
}

// Deterministic per-user + per-return thread ID. Must match the format used
// by /app/state in apps/agent (no shared package yet — keep these in sync).
// When we move to per-filing scoping, extend this with a filing identifier.
export function threadIdFor(userId: string, returnId: string): string {
  return `${userId}::${returnId}`;
}
