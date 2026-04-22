import { derive, fact } from "../../case";
import type { Artifact, ScopingStatus } from "./types";

export const ca540: Artifact = {
  id: "ca-form-540",
  name: "California Form 540",
  year: 2025,
  kind: "state_form",
  purpose: "California resident individual income tax return",
  filingDeadline: "2026-04-15",
  mvpSupported: true,
};

export const ca540Scope = derive({
  id: "scope.ca-form-540",
  description:
    "CA Form 540 is in scope if the taxpayer was a California resident at any point in the tax year.",
  inputs: {
    state: fact<string | undefined>("residency.state"),
  },
  compute: ({ state }): ScopingStatus => {
    if (state === "CA") {
      return { status: "in_scope", reason: "Taxpayer is a California resident" };
    }
    if (state === undefined) {
      return {
        status: "pending",
        reason: "State residency not yet recorded",
        needs: ["residency.state"],
      };
    }
    return {
      status: "out_of_scope",
      reason: `Taxpayer is a ${state} resident, not California`,
    };
  },
});
