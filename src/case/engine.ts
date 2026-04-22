import type {
  CaseState,
  Derivation,
  DerivationOutputMap,
  FactMap,
} from "./types";

// Pure evaluator. Given the current fact map and a list of derivations,
// run them in topological order and return the full case state.
//
// For Alex-scale cases (tens of derivations, tens of facts), this is
// fast enough to run on every fact write — no memoization needed yet.
// When the artifact library grows to hundreds of derivations, we'll
// add invalidation via dependency tracking, but the API won't change.
export function computeCaseState(
  facts: FactMap,
  derivations: Derivation[],
): CaseState {
  const sorted = topologicalSort(derivations);
  const outputs: DerivationOutputMap = {};

  for (const d of sorted) {
    const resolved: Record<string, unknown> = {};
    for (const [key, input] of Object.entries(d.inputs)) {
      if (input.kind === "fact") {
        resolved[key] = facts[input.key];
      } else {
        // derivation ref — must already be computed since we're sorted
        resolved[key] = outputs[input.id];
      }
    }
    outputs[d.id] = d.compute(resolved);
  }

  return { facts, derivations: outputs };
}

// Kahn-style topo sort via recursive DFS. Throws on cycles or unknown
// derivation references so bugs surface at evaluate-time rather than
// silently producing wrong case state.
function topologicalSort(derivations: Derivation[]): Derivation[] {
  const byId = new Map<string, Derivation>(
    derivations.map((d) => [d.id, d]),
  );
  if (byId.size !== derivations.length) {
    const seen = new Set<string>();
    const dup = derivations.find((d) => {
      if (seen.has(d.id)) return true;
      seen.add(d.id);
      return false;
    });
    throw new Error(`Duplicate derivation id: ${dup?.id}`);
  }

  const sorted: Derivation[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (d: Derivation, stack: string[]): void => {
    if (visited.has(d.id)) return;
    if (visiting.has(d.id)) {
      throw new Error(
        `Cycle detected in derivation graph: ${[...stack, d.id].join(" → ")}`,
      );
    }
    visiting.add(d.id);

    for (const input of Object.values(d.inputs)) {
      if (input.kind === "derivation") {
        const dep = byId.get(input.id);
        if (!dep) {
          throw new Error(
            `Derivation "${d.id}" depends on unknown derivation "${input.id}"`,
          );
        }
        visit(dep, [...stack, d.id]);
      }
    }

    visiting.delete(d.id);
    visited.add(d.id);
    sorted.push(d);
  };

  for (const d of derivations) visit(d, []);
  return sorted;
}
