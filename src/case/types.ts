// The case engine: a graph of typed, pure-function derivations over the
// case's fact set. Each fact write triggers re-derivation; derivations
// declare their inputs (either facts or upstream derivations), and the
// engine runs them in topological order on every compute.
//
// The goal is a "live" case state: given the current set of facts, what
// does the return look like? What's still missing? What decisions have
// we made? This file defines the data model for that graph.

export type FactRef<T = unknown> = {
  kind: "fact";
  key: string;
  // phantom type parameter — preserved only at compile time for inference
  _type?: T;
};

export type DerivationRef<T = unknown> = {
  kind: "derivation";
  id: string;
  _type?: T;
};

export type InputRef<T = unknown> = FactRef<T> | DerivationRef<T>;

export type InferInputType<T> = T extends InputRef<infer U> ? U : never;

export type DerivationInputs = Record<string, InputRef<any>>;

export type ResolvedInputs<T extends DerivationInputs> = {
  [K in keyof T]: InferInputType<T[K]>;
};

export interface Derivation<TOutput = unknown> {
  id: string;
  description?: string;
  inputs: DerivationInputs;
  compute: (inputs: Record<string, unknown>) => TOutput;
}

// Flat map of the current (latest, non-superseded) value per fact key.
// Keys are dotted paths: "identity.filing_status", "wages.w2[0].box1", etc.
export type FactMap = Record<string, unknown>;

// Derivation id → computed output.
export type DerivationOutputMap = Record<string, unknown>;

export interface CaseState {
  facts: FactMap;
  derivations: DerivationOutputMap;
}
