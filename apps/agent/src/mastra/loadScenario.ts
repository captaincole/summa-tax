// The one bridge between the db layer and the pure form engine: load a
// filing's fact + decision rows, hand them to evaluateScenario. All I/O
// stays on this side of the engine boundary — the engine itself never
// touches a database (see ../engine/README.md).

import type { Scope } from "./db/appDb";
import { listFacts } from "./db/taxFacts";
import { listDecisions } from "./db/aiDecisions";
import {
  evaluateScenario,
  type EngineFiling,
  type EvaluatedScenario,
} from "../engine";

export async function loadAndEvaluateScenario(
  scope: Scope,
  filing: EngineFiling,
  authEmail: string | null = null,
): Promise<EvaluatedScenario> {
  const [facts, decisions] = await Promise.all([
    listFacts(scope, { filingId: filing.id, limit: 500 }),
    listDecisions(scope, { filingId: filing.id, limit: 500 }),
  ]);
  return evaluateScenario({ filing, facts, decisions, authEmail });
}
