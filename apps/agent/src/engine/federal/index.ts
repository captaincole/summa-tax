// Federal form registry — every federal form the engine knows about, plus
// the bundled runtime catalogs for the ones with bindings. Composed into
// the global FORMS list by ../registry.ts.
//
// Order is upstreams-first (8949 totals feed Schedule D, which feeds 1040).
// The fixpoint evaluator converges regardless of order — this only keeps
// the pass count low.
//
// Adding a federal form:
//   1. Drop catalog.json + blank.pdf into apps/agent/forms/federal/<short>/
//      and promote the runtime copy to src/mastra/public/forms/federal/<short>/
//   2. Write types.ts + filingInfo.ts + bindings.ts under ./<short>/
//   3. Add a makeFormSpec entry below (+ its catalog import, if it has bindings)

import { makeFormSpec, type FormSpec } from "../formSpec.js";
import { fixtureFileSchema } from "../catalog.js";
import { register as registerForm1040 } from "./1040/bindings.js";
import { register as registerForm8949 } from "./8949/bindings.js";
import { register as registerScheduleD } from "./schedule-d/bindings.js";
import { register as registerScheduleA } from "./schedule-a/bindings.js";
import { register as registerForm8959 } from "./8959/bindings.js";

// Static JSON imports — sourced from the PROMOTED runtime copies under
// src/mastra/public/forms/, not the offline source-of-truth at
// apps/agent/forms/. This gives us a promotion gate: ingesting a new
// catalog updates apps/agent/forms/ (tests run against it), and only
// after a `forms:promote` cp does the runtime pick up the change.
// Rollup inlines these JSON contents at build time; nothing reads them
// from disk in the running process.
import form8949CatalogJson from "../../mastra/public/forms/federal/8949/catalog.json";
import scheduleDCatalogJson from "../../mastra/public/forms/federal/schedule-d/catalog.json";
import scheduleACatalogJson from "../../mastra/public/forms/federal/schedule-a/catalog.json";
import form8959CatalogJson from "../../mastra/public/forms/federal/8959/catalog.json";
import form1040CatalogJson from "../../mastra/public/forms/federal/1040/catalog.json";

// fixtureFileSchema.parse() narrows TypeScript's widened JSON types
// (e.g. `category: string` → `category: Category`) and fails loud at
// boot if any catalog drifts from FixtureFile.
export const FEDERAL_CATALOGS = [
  fixtureFileSchema.parse(form8949CatalogJson),
  fixtureFileSchema.parse(scheduleDCatalogJson),
  fixtureFileSchema.parse(scheduleACatalogJson),
  fixtureFileSchema.parse(form8959CatalogJson),
  fixtureFileSchema.parse(form1040CatalogJson),
];

export const FEDERAL_FORMS: FormSpec[] = [
  makeFormSpec({
    formId: "form-8949",
    shortId: "8949",
    displayName: "Form 8949",
    relativeDir: "federal/8949",
    register: registerForm8949,
  }),
  makeFormSpec({
    formId: "schedule-d",
    shortId: "schedule-d",
    displayName: "Schedule D",
    relativeDir: "federal/schedule-d",
    register: registerScheduleD,
  }),
  makeFormSpec({
    formId: "form-1040",
    shortId: "1040",
    displayName: "Form 1040",
    relativeDir: "federal/1040",
    register: registerForm1040,
  }),
  makeFormSpec({
    formId: "schedule-a",
    shortId: "schedule-a",
    displayName: "Schedule A",
    relativeDir: "federal/schedule-a",
    register: registerScheduleA,
  }),
  // Catalog-only entries (no bindings yet — deferred). These exist so the
  // catalog-fill regression test in runAll.ts checks them against their
  // blank PDFs. Bindings + downstream wiring land in a follow-up PR.
  makeFormSpec({
    formId: "schedule-b",
    shortId: "schedule-b",
    displayName: "Schedule B",
    relativeDir: "federal/schedule-b",
  }),
  // No instructions.pdf in schedule-2/ by design — IRS publishes Schedule 2
  // instructions only as part of the 1040 instructions booklet (already in
  // the corpus as irs-1040-inst-2025), so the cross-reference is implicit.
  makeFormSpec({
    formId: "schedule-2",
    shortId: "schedule-2",
    displayName: "Schedule 2",
    relativeDir: "federal/schedule-2",
  }),
  makeFormSpec({
    formId: "form-8889",
    shortId: "8889",
    displayName: "Form 8889",
    relativeDir: "federal/8889",
  }),
  makeFormSpec({
    formId: "form-8959",
    shortId: "8959",
    displayName: "Form 8959",
    relativeDir: "federal/8959",
    register: registerForm8959,
  }),
  makeFormSpec({
    formId: "form-8960",
    shortId: "8960",
    displayName: "Form 8960",
    relativeDir: "federal/8960",
  }),
];
