// A tax "artifact" is anything we produce or consume in the course of
// preparing a return: output forms (1040, CA 540), schedules (A, B, ...),
// or source documents (W-2, 1098, 1099). Each one is declarative data.
//
// The *scoping logic* for each artifact lives in a companion derivation
// that reads facts and returns the artifact's current status. This keeps
// artifacts themselves as pure metadata and puts all behavior in the
// case engine's derivation graph.

export type ScopingStatus =
  | { status: "in_scope"; reason: string }
  | { status: "out_of_scope"; reason: string }
  | { status: "pending"; reason: string; needs: string[] };

export type ArtifactKind =
  | "federal_form"     // e.g. Form 1040
  | "federal_schedule" // e.g. Schedule A, B, 8812
  | "state_form"       // e.g. CA Form 540
  | "source_document"; // e.g. W-2, 1098

export interface Artifact {
  id: string;
  name: string;
  year: number;
  kind: ArtifactKind;
  purpose: string;
  filingDeadline?: string; // ISO date (YYYY-MM-DD)
  mvpSupported: boolean;
}
