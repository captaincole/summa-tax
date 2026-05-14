// Foundation inspection — runs Alex's facts/decisions through the new
// values/accounting/defineForm shape so you can eyeball the wiring before
// we port the real 1040.
//
// Run: npm run forms:inspect:foundation
//
// What it prints (in order):
//   1. Alex's input facts + decisions, summarized.
//   2. The Accounting blob produced by resolveAccounting() — the typed
//      view a binding gets via `acct.X`.
//   3. A four-line mock form (header.first_name_mi, header.ssn, line.1a,
//      line.1z) registered via defineForm + evaluated end-to-end.
//   4. Per-field formatter dispatch — Money.format default + an SSN.digits
//      override registered through FormSpec.formatters.

import {
  _resetRegistryForTests,
  defineForm,
  evaluateForm,
  getFormatter,
  getFormSpecMeta,
  sum,
} from "../src/mastra/forms/engine.js";
import { makeCatalog, type FieldInventory } from "../src/mastra/forms/catalog.js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/forms/types.js";
import {
  resolveFilingInfo,
  type FilingInfo,
} from "../src/mastra/forms/filingInfo.js";
import { Money, SSN } from "../src/mastra/forms/values.js";
import { alexFacts } from "../tests/scenarios/alex/facts.js";
import { alexDecisions } from "../tests/scenarios/alex/decisions.js";

// ─── Helpers ─────────────────────────────────────────────────────────────

const hr = (label: string) => {
  const bar = "─".repeat(72);
  console.log(`\n${bar}\n${label}\n${bar}`);
};

const printJson = (label: string, value: unknown) => {
  console.log(`${label}:`);
  console.log(
    JSON.stringify(value, null, 2)
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );
};

// ─── 1. Inputs ───────────────────────────────────────────────────────────

hr("1. Inputs — Alex's facts + decisions");

console.log(`Facts (${alexFacts.length}):`);
for (const f of alexFacts) {
  const preview =
    typeof f.value === "object" && f.value !== null
      ? "{…}"
      : JSON.stringify(f.value);
  console.log(`  ${f.key.padEnd(40)}  ${preview}`);
}

console.log(`\nDecisions (${alexDecisions.length}):`);
for (const d of alexDecisions) {
  console.log(`  ${d.decisionKey.padEnd(56)}  ${JSON.stringify(d.decision)}`);
}

// ─── 2. Resolved Accounting blob ─────────────────────────────────────────

hr("2. resolveFilingInfo() output — the typed view bindings consume");

const filingInfo: FilingInfo = resolveFilingInfo({
  facts: alexFacts.map((f) => ({
    key: f.key,
    value: f.value,
    category: f.category,
  })),
  decisions: alexDecisions.map((d) => ({
    decisionKey: d.decisionKey,
    decision: d.decision,
  })),
});

printJson("info", filingInfo);

const populatedSlots = Object.entries(filingInfo).filter(
  ([, v]) => v !== undefined,
).length;
const totalSlotKeys = Object.keys(filingInfo).length;
console.log(
  `\n  populated slots: ${populatedSlots} / ${totalSlotKeys} (the rest are undefined — slots Alex's scenario doesn't exercise)`,
);

// ─── 3. Mock form via defineForm — four lines + evaluation ───────────────

hr("3. defineForm() mock — four fields, evaluated end-to-end");

// Reset the engine registry so we can register a one-off mock form without
// colliding with any production binding files.
_resetRegistryForTests();

// Typed shape declaration — would be auto-emitted by the ingest workflow
// from the catalog in the real pipeline. Drafted by hand here.
interface MockForm {
  "header.first_name_mi": string;
  "header.ssn": SSN;
  "line.1a": Money;
  "line.1z": Money;
}

const FORM_ID = "mock-form";

// Mock catalog — four field inventory rows in ordinal order so the engine
// evaluates 1a before 1z.
const catalog = makeCatalog({
  forms: [
    {
      formId: FORM_ID,
      taxYear: 2025,
      jurisdiction: "federal",
      title: "Mock form for foundation inspection",
    },
  ],
  fields: [
    {
      fieldId: `${FORM_ID}.header.first_name_mi`,
      formId: FORM_ID,
      label: "First name",
      category: "personal_info",
      valueType: "text",
      ordinal: 0,
    },
    {
      fieldId: `${FORM_ID}.header.ssn`,
      formId: FORM_ID,
      label: "SSN",
      category: "personal_info",
      valueType: "text",
      ordinal: 1,
    },
    {
      fieldId: `${FORM_ID}.line.1a`,
      formId: FORM_ID,
      label: "Total wages",
      category: "income",
      valueType: "numeric",
      ordinal: 2,
    },
    {
      fieldId: `${FORM_ID}.line.1z`,
      formId: FORM_ID,
      label: "Sum of 1a..1h",
      category: "income",
      valueType: "numeric",
      ordinal: 3,
    },
  ] satisfies FieldInventory[],
});

// Register the typed bindings. The function bodies are exactly the shape
// the AI will emit (or a human will hand-edit) in the real binding files.
defineForm<MockForm>(FORM_ID, {
  mustFile: (info) => info.mustFileFederal,
  bindings: {
    "header.first_name_mi": (_f, info) => info.taxpayerFirstName,
    "header.ssn": (_f, info) => info.taxpayerSSN,
    "line.1a": (_f, info) => info.w2WagesTotal,
    "line.1z": (f) => sum(f["line.1a"]) as Money,
  },
  formatters: {
    // Default Money.format would emit "79000". This per-field override is
    // illustrative — for line.1z it doesn't change anything, but it
    // demonstrates per-field dispatch.
    "line.1z": (m) => `$${m.toLocaleString("en-US")}`,
    // SSN dashes → digits for PDF widgets.
    "header.ssn": (s) => SSN.digits(s),
  },
});

// Print spec meta — what defineForm registered.
const meta = getFormSpecMeta(FORM_ID)!;
console.log(`Form spec meta for "${FORM_ID}":`);
console.log(`  mustFileBound:    ${meta.mustFileBound}`);
console.log(`  bindings:         [${meta.bindingKeys.join(", ")}]`);
console.log(`  formatters:       [${meta.formatterKeys.join(", ")}]`);
console.log(`  unsupported:      [${meta.unsupportedKeys.join(", ") || "—"}]`);
console.log(`  todos:            [${meta.todoKeys.join(", ") || "—"}]`);

// Evaluate the form. evaluateForm walks the catalog in ordinal order, calls
// each binding (which the wrapper translates into a synthesized Rule), and
// caches results in fieldResults so dependents downstream can read them.
const ctx: DerivationContext = {
  taxYear: 2025,
  facts: makeFactsView(alexFacts),
  decisions: makeDecisionsView(alexDecisions),
  filingInfo,
};

const evaluated = evaluateForm(FORM_ID, ctx, catalog);

console.log(`\nmust-file: ${JSON.stringify(evaluated.mustFile)}`);
console.log(`\nFields (${evaluated.fields.length}):`);
for (const f of evaluated.fields) {
  if (!f.result.ok) {
    console.log(
      `  ✗ ${f.fieldId.padEnd(36)} blocked: ${f.result.reason}${
        f.result.unsupported ? " (unsupported)" : ""
      }`,
    );
    continue;
  }
  console.log(
    `  ✓ ${f.fieldId.padEnd(36)} ${String(f.result.value).padEnd(20)}  [${f.valueType}]`,
  );
}

// ─── 4. Formatter dispatch ───────────────────────────────────────────────

hr("4. Formatter dispatch — overrides vs brand defaults");

for (const f of evaluated.fields) {
  if (!f.result.ok) continue;
  const override = getFormatter(f.fieldId);
  const value = f.result.value;
  let viaOverride: string | null = null;
  let viaDefault: string | null = null;

  if (override) {
    try {
      viaOverride = override(value as never);
    } catch (e) {
      viaOverride = `(override threw: ${e instanceof Error ? e.message : String(e)})`;
    }
  }
  if (f.valueType === "numeric" && typeof value === "number") {
    viaDefault = Money.format(value as Money);
  } else if (f.valueType === "text" && typeof value === "string") {
    viaDefault = value;
  }

  console.log(`  ${f.fieldId}`);
  console.log(`     raw value:    ${JSON.stringify(value)}`);
  console.log(`     default:      ${viaDefault === null ? "(no default)" : `"${viaDefault}"`}`);
  console.log(`     override:     ${viaOverride === null ? "(none registered)" : `"${viaOverride}"`}`);
  console.log(
    `     renderer would write: "${viaOverride ?? viaDefault ?? String(value)}"`,
  );
  console.log();
}

console.log("Done. Re-run any time with `npm run forms:inspect:foundation`.\n");
