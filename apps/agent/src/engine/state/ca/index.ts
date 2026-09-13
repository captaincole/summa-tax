// California form registry — everything CA-specific the engine evaluates.
// Composed into STATE_FORMS by ../index.ts. Self-contained by design: CA's
// forms, filingInfo projections, and (as they accumulate) data tables all
// live under state/ca/. A CA-focused contributor should never need to
// touch federal/ or another state's directory.
//
// Order is upstreams-first within the state (Schedule CA adjustments feed
// the 540). Cross-form reads of federal results (540 line 13 ← 1040 AGI)
// resolve on a later fixpoint pass — see ../../registry.ts.

import { makeFormSpec, type FormSpec } from "../../formSpec.js";
import { fixtureFileSchema } from "../../catalog.js";
import { register as registerForm540 } from "./540/bindings.js";
import { register as registerScheduleCa } from "./schedule-ca/bindings.js";

// Promoted runtime catalog copies — see ../../federal/index.ts for why
// these import from src/mastra/public/forms/ rather than apps/agent/forms/.
import scheduleCaCatalogJson from "../../../mastra/public/forms/state/ca/schedule-ca/catalog.json";
import form540CatalogJson from "../../../mastra/public/forms/state/ca/540/catalog.json";

export const CA_CATALOGS = [
  fixtureFileSchema.parse(scheduleCaCatalogJson),
  fixtureFileSchema.parse(form540CatalogJson),
];

export const CA_FORMS: FormSpec[] = [
  makeFormSpec({
    formId: "schedule-ca",
    shortId: "schedule-ca",
    displayName: "Schedule CA (540)",
    relativeDir: "state/ca/schedule-ca",
    register: registerScheduleCa,
  }),
  makeFormSpec({
    formId: "form-540",
    shortId: "540",
    displayName: "Form 540",
    relativeDir: "state/ca/540",
    register: registerForm540,
  }),
];
