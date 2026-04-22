import { derive } from "../../case";
import type { Artifact, ScopingStatus } from "./types";

export const form1040: Artifact = {
  id: "form-1040",
  name: "Form 1040",
  year: 2025,
  kind: "federal_form",
  purpose: "Annual federal individual income tax return",
  filingDeadline: "2026-04-15",
  mvpSupported: true,
};

export const form1040Scope = derive({
  id: "scope.form-1040",
  description: "Form 1040 is always in scope for US individual filers.",
  inputs: {},
  compute: (): ScopingStatus => ({
    status: "in_scope",
    reason: "Always required for US individual filers",
  }),
});
