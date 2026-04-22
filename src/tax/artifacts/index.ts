import type { Derivation } from "../../case";
import type { Artifact } from "./types";
import { form1040, form1040Scope } from "./form1040";
import { ca540, ca540Scope } from "./ca540";
import { w2Source, w2SourceScope } from "./w2Source";
import { mvpScopeCheck } from "./mvpScopeCheck";

// All artifacts the MVP knows about. Anything outside this list that
// gets triggered by user facts falls through to the mvpScopeCheck
// derivation, which surfaces a violation so Thom can decline.
export const artifacts: Artifact[] = [form1040, ca540, w2Source];

// Scope derivations — one per artifact, plus the aggregate MVP check.
// These get registered with the case engine alongside the domain
// derivations from src/case/derivations/.
export const artifactScopeDerivations: Derivation[] = [
  form1040Scope,
  ca540Scope,
  w2SourceScope,
  mvpScopeCheck,
];

// Convenience: look up an artifact by id.
export const getArtifact = (id: string): Artifact | undefined =>
  artifacts.find((a) => a.id === id);

export { form1040, ca540, w2Source, mvpScopeCheck };
export type { MvpScopeResult } from "./mvpScopeCheck";
export type { Artifact, ScopingStatus, ArtifactKind } from "./types";
