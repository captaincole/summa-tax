import { derive, fact } from "../../case";
import type { Artifact, ScopingStatus } from "./types";

// W-2 as a source document, not an output form. We need one (or more)
// W-2s when the taxpayer had wage income from an employer.
export const w2Source: Artifact = {
  id: "w2-source",
  name: "Form W-2 (source document)",
  year: 2025,
  kind: "source_document",
  purpose: "Employer wage and tax statement — drives 1040 lines 1a, 25a and state wages",
  mvpSupported: true,
};

export const w2SourceScope = derive({
  id: "scope.w2-source",
  description:
    "W-2 is needed when the taxpayer had wage income from an employer.",
  inputs: {
    hasW2Income: fact<boolean | undefined>("wages.has_w2_income"),
  },
  compute: ({ hasW2Income }): ScopingStatus => {
    if (hasW2Income === true) {
      return {
        status: "in_scope",
        reason: "Taxpayer confirmed W-2 wage income",
      };
    }
    if (hasW2Income === false) {
      return { status: "out_of_scope", reason: "No W-2 wage income" };
    }
    return {
      status: "pending",
      reason: "Haven't confirmed whether taxpayer has W-2 wages",
      needs: ["wages.has_w2_income"],
    };
  },
});
