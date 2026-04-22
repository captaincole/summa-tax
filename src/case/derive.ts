import type {
  Derivation,
  DerivationInputs,
  DerivationRef,
  FactRef,
  ResolvedInputs,
} from "./types";

// Reference a fact by its dotted key path. The type parameter documents
// the expected value type; it's not enforced at runtime (facts come in
// loosely typed from the DB layer).
export function fact<T = unknown>(key: string): FactRef<T> {
  return { kind: "fact", key };
}

// Reference another derivation by id. The type parameter lets the
// derivation that depends on it see the upstream output type.
export function derivation<T = unknown>(id: string): DerivationRef<T> {
  return { kind: "derivation", id };
}

// Declare a derivation. Input types are inferred from the `inputs` map
// and flow into the `compute` function's parameter types.
export function derive<TInputs extends DerivationInputs, TOutput>(spec: {
  id: string;
  description?: string;
  inputs: TInputs;
  compute: (inputs: ResolvedInputs<TInputs>) => TOutput;
}): Derivation<TOutput> {
  return {
    id: spec.id,
    description: spec.description,
    inputs: spec.inputs,
    compute: (inputs: Record<string, unknown>) =>
      spec.compute(inputs as ResolvedInputs<TInputs>),
  };
}
