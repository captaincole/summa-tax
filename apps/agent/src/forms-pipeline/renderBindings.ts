// Phase D — render typed bindings into TypeScript source for a per-form
// `bindings.ts` file under `src/mastra/forms/<jurisdiction>/<short>/`.
//
// The classifier outputs structured bindings (one of N rule shapes per
// field) plus a confidence rating. This renderer translates each binding
// into a typed TS function body for the new `defineForm<TForm, TInfo>`
// shape, routes anything below `minConfidence` to a `todos` map, and
// surfaces fact / decision keys that don't have a known FilingInfo slot
// as todos as well (with rationale).
//
// Layout of the emitted file:
//
//   import { defineForm, sum, floor } from "<relative engine.ts>";
//   import { lookupTax } from "<relative data/taxTable.ts>";
//   import type { Form540 } from "./types.js";
//   import type { Form540FilingInfo } from "./filingInfo.js";
//
//   export function register(): void {
//     defineForm<Form540, Form540FilingInfo>("form-540", {
//       mustFile: (info) => info.mustFileCA540,
//       bindings: {
//         "header.first_name": (_, info) => info.taxpayerFirstName,
//         "line.12_state_wages": (_, info) => info.w2StateWages,
//         "line.31_tax_amount": (f, info) => {
//           if (!info.filingStatus) return undefined;
//           const income = f["line.19_taxable_income"];
//           if (typeof income !== "number") return undefined;
//           const r = lookupTax("ca-2025", income, info.filingStatus);
//           return r.ok ? r.tax : undefined;
//         },
//         …
//       },
//       unsupported: {
//         "header.combat_zone_checkbox": "No combat-zone scenario built yet.",
//       },
//       todos: {
//         "line.40_ctc": "fromFields with terms whose source form isn't ingested",
//       },
//     });
//   }
//
// Each item the classifier rated below the minConfidence floor lands in
// `todos`. Items whose rule is `unsupported` always land in `unsupported`.

import { dirname, relative } from "node:path";
import type {
  ClassifiedBinding,
  Confidence,
  RuleName,
} from "./classifyBindings.js";
import type { FieldInventory } from "../mastra/forms/catalog.js";

// ─── FilingInfo slot translation tables ──────────────────────────────────
// Maps the AI's rule params (which reference raw fact / decision keys) to
// the typed slot names in FilingInfo. When a key isn't in the table the
// renderer pushes the binding to `todos` so a human reviews it — either
// to add the slot to FilingInfo or to clarify the AI's choice.

const FACT_TO_SLOT: Record<string, string> = {
  "identity.name.first": "taxpayerFirstName",
  "identity.name.middle_initial": "taxpayerMiddleInitial",
  "identity.name.last": "taxpayerLastName",
  "identity.ssn": "taxpayerSSN",
  "identity.dob": "taxpayerDateOfBirth",
  "identity.address.street": "homeAddressLine1",
  "identity.address.apt": "homeAddressApt",
  "identity.address.city": "homeAddressCity",
  "identity.address.state": "homeAddressState",
  "identity.address.zip": "homeAddressZip",
  "identity.address.county": "homeAddressCounty",
  "identity.email": "taxpayerEmail",
  "identity.phone": "taxpayerPhone",
  "identity.occupation": "taxpayerOccupation",
  "use_tax.owed_amount": "useTaxOwed",
  "health_coverage.full_year_mec": "fullYearMEC",
};

const DECISION_TO_SLOT: Record<string, string> = {
  "decisions.scope.must_file_federal": "mustFileFederal",
  "decisions.scope.must_file_ca_540": "mustFileCA540",
  "decisions.scope.filing_status": "filingStatus",
  "decisions.scope.ca_residency": "caResidencyStatus",
  "decisions.scope.mailing_same_as_principal_residence":
    "mailingSameAsResidence",
  "decisions.scope.use_tax_zero_reason": "useTaxZeroReason",
  "decisions.refund.refund_full_overpayment_federal": "refundFullOverpaymentFederal",
  "decisions.refund.refund_full_overpayment_ca": "refundFullOverpaymentCA",
};

// sumFacts identity: `${category}|${keyPrefix ?? ""}|${fieldPath}`.
const SUM_FACTS_TO_SLOT: Record<string, string> = {
  "wages|employer.|box1": "w2WagesTotal",
  "wages|employer.|box2": "w2FederalWithholding",
  "wages|employer.|box16": "w2StateWages",
  "wages|employer.|box17": "w2StateWithholding",
  "investment_income|account.|box1a": "ordinaryDividends",
  "investment_income|account.|box1b": "qualifiedDividends",
  "investment_income|account.|box4": "form1099FederalWithholding",
};

// ─── Public shapes ───────────────────────────────────────────────────────

export interface RenderBindingsOpts {
  formId: string;
  taxYear: number;
  jurisdiction: string;
  formTitle: string;
  fields: FieldInventory[]; // catalog ordinal order
  bindings: ClassifiedBinding[];
  mustFile: { decisionKey: string; rationale: string };
  /** Absolute path the rendered TS will be written to. Used to compute relative imports. */
  outputPath: string;
  /**
   * Minimum confidence to commit a binding into `bindings`. Anything below
   * goes to `todos` for human review.
   */
  minConfidence: Confidence;
  /**
   * Names of the Form-id-specific types to import — derived from the
   * caller's per-form layout (e.g. `Form540`, `Form540FilingInfo`).
   */
  typeInterfaceName: string;
  filingInfoInterfaceName: string;
}

export interface RenderBindingsReport {
  source: string;
  emittedCount: number;
  todoCount: number;
  unsupportedCount: number;
  unboundCount: number;
  confidenceBreakdown: Record<Confidence, number>;
  ruleBreakdown: Record<string, number>;
}

// ─── Entry point ─────────────────────────────────────────────────────────

export function renderBindings(opts: RenderBindingsOpts): RenderBindingsReport {
  const bindingByFieldId = new Map<string, ClassifiedBinding>();
  for (const b of opts.bindings) {
    if (!bindingByFieldId.has(b.fieldId)) bindingByFieldId.set(b.fieldId, b);
  }

  const minOrder = CONFIDENCE_ORDER[opts.minConfidence];

  // Bucketize each catalog field.
  const entries: Array<
    | { kind: "binding"; field: FieldInventory; body: string; rationale: string }
    | { kind: "unsupported"; field: FieldInventory; reason: string }
    | { kind: "todo"; field: FieldInventory; reason: string }
    | { kind: "unbound"; field: FieldInventory }
  > = [];

  const ruleBreakdown: Record<string, number> = {};
  const confidenceBreakdown: Record<Confidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  let usesLookupTax = false;
  let usesSum = false;
  let usesFloor = false;

  for (const field of opts.fields) {
    const binding = bindingByFieldId.get(field.fieldId);
    if (!binding) {
      entries.push({ kind: "unbound", field });
      continue;
    }
    ruleBreakdown[binding.ruleName] =
      (ruleBreakdown[binding.ruleName] ?? 0) + 1;
    confidenceBreakdown[binding.confidence]++;

    // `unsupported` rule always goes to the unsupported map regardless of
    // confidence — engine treats these the same as `unsupported`.
    if (binding.ruleName === "unsupported") {
      const reason = String(binding.params.reason ?? binding.rationale);
      entries.push({ kind: "unsupported", field, reason });
      continue;
    }

    // Confidence floor — under-rated bindings become todos.
    if (CONFIDENCE_ORDER[binding.confidence] < minOrder) {
      entries.push({
        kind: "todo",
        field,
        reason: `confidence=${binding.confidence}: ${binding.rationale}`,
      });
      continue;
    }

    // Translate the binding to a TS function body.
    const translated = translate(binding, opts.formId);
    if (translated.kind === "todo") {
      entries.push({
        kind: "todo",
        field,
        reason: `${binding.ruleName}: ${translated.reason}`,
      });
      continue;
    }
    if (translated.usesLookupTax) usesLookupTax = true;
    if (translated.usesSum) usesSum = true;
    if (translated.usesFloor) usesFloor = true;
    entries.push({
      kind: "binding",
      field,
      body: translated.body,
      rationale: binding.rationale,
    });
  }

  // ─── Build the source string ─────────────────────────────────────────

  const engineImport = relImport(
    opts.outputPath,
    "src/mastra/forms/engine.ts",
  );
  const taxTableImport = relImport(
    opts.outputPath,
    "src/mastra/forms/data/taxTable.ts",
  );

  const engineSymbols = ["defineForm"];
  if (usesSum) engineSymbols.push("sum");
  if (usesFloor) engineSymbols.push("floor");

  const out: string[] = [];
  out.push(
    `// AI-generated by forms:bind. Hand edits are allowed; mark them with`,
  );
  out.push(
    `// \`// MANUAL EDIT:\` so they're easy to find + re-apply after a regen.`,
  );
  out.push(`// Source: forms-pipeline/generateBindingsWorkflow`);
  out.push(
    `// Form: ${opts.formTitle} (${opts.formId}, tax year ${opts.taxYear})`,
  );
  out.push(`// Generated at: ${new Date().toISOString()}`);
  out.push("");
  out.push(`import { ${engineSymbols.join(", ")} } from "${engineImport}";`);
  if (usesLookupTax) {
    out.push(`import { lookupTax } from "${taxTableImport}";`);
  }
  out.push(`import type { ${opts.typeInterfaceName} } from "./types.js";`);
  out.push(
    `import type { ${opts.filingInfoInterfaceName} } from "./filingInfo.js";`,
  );
  out.push("");
  out.push(`// Wrapping defineForm inside a register() function lets callers`);
  out.push(
    `// import { register } and force the side-effectful registration once`,
  );
  out.push(`// at startup. Idempotent — calling twice overwrites in place.`);
  out.push(`export function register(): void {`);
  out.push(
    `  defineForm<${opts.typeInterfaceName}, ${opts.filingInfoInterfaceName}>(${quote(opts.formId)}, {`,
  );

  // mustFile
  const mustFileSlot = DECISION_TO_SLOT[opts.mustFile.decisionKey];
  if (mustFileSlot) {
    out.push(`    // ${opts.mustFile.rationale}`);
    out.push(`    mustFile: (info) => info.${mustFileSlot},`);
  } else {
    // No slot for this decision — leave a TODO; engine will refuse to
    // evaluate the form until this is filled in.
    out.push(
      `    // TODO: must-file decision "${opts.mustFile.decisionKey}" has no FilingInfo slot.`,
    );
    out.push(`    // ${opts.mustFile.rationale}`);
    out.push(`    // mustFile: (info) => info.???,`);
  }
  out.push("");

  // bindings
  const bindingEntries = entries.filter((e) => e.kind === "binding") as Array<{
    kind: "binding";
    field: FieldInventory;
    body: string;
    rationale: string;
  }>;
  out.push(`    bindings: {`);
  for (const e of bindingEntries) {
    out.push(`      // ${e.rationale}`);
    out.push(
      `      ${quote(shortKey(e.field.fieldId, opts.formId))}: ${e.body},`,
    );
  }
  out.push(`    },`);
  out.push("");

  // unsupported
  const unsupportedEntries = entries.filter(
    (e) => e.kind === "unsupported",
  ) as Array<{ kind: "unsupported"; field: FieldInventory; reason: string }>;
  if (unsupportedEntries.length > 0) {
    out.push(`    unsupported: {`);
    for (const e of unsupportedEntries) {
      out.push(
        `      ${quote(shortKey(e.field.fieldId, opts.formId))}: ${quote(e.reason)},`,
      );
    }
    out.push(`    },`);
    out.push("");
  }

  // todos
  const todoEntries = entries.filter((e) => e.kind === "todo") as Array<{
    kind: "todo";
    field: FieldInventory;
    reason: string;
  }>;
  if (todoEntries.length > 0) {
    out.push(`    todos: {`);
    for (const e of todoEntries) {
      out.push(
        `      ${quote(shortKey(e.field.fieldId, opts.formId))}: ${quote(e.reason)},`,
      );
    }
    out.push(`    },`);
    out.push("");
  }

  out.push(`  });`);
  out.push(`}`);
  out.push("");

  const emittedCount = bindingEntries.length;
  const todoCount = todoEntries.length;
  const unsupportedCount = unsupportedEntries.length;
  const unboundCount = entries.filter((e) => e.kind === "unbound").length;

  out.push(
    `// Summary: ${emittedCount} binding(s), ${todoCount} todo(s), ${unsupportedCount} unsupported, ${unboundCount} unbound.`,
  );
  out.push(
    `// Confidence: ${confidenceBreakdown.high} high, ${confidenceBreakdown.medium} medium, ${confidenceBreakdown.low} low.`,
  );
  out.push("");

  return {
    source: out.join("\n"),
    emittedCount,
    todoCount,
    unsupportedCount,
    unboundCount,
    confidenceBreakdown,
    ruleBreakdown,
  };
}

// ─── Translation: classifier rule → TS function body ─────────────────────

type Translation =
  | {
      kind: "body";
      body: string;
      usesLookupTax?: boolean;
      usesSum?: boolean;
      usesFloor?: boolean;
    }
  | { kind: "todo"; reason: string };

function translate(b: ClassifiedBinding, formId: string): Translation {
  switch (b.ruleName) {
    case "lookupFact":
      return translateLookupFact(b);
    case "sumFacts":
      return translateSumFacts(b);
    case "lookupDecision":
      return translateLookupDecision(b);
    case "decisionIfEquals":
      return translateDecisionIfEquals(b);
    case "tableLookupByDecision":
      return translateTableLookupByDecision(b);
    case "fromFields":
      return translateFromFields(b, formId);
    case "taxTable":
      return translateTaxTable(b, formId);
    case "constant":
      return translateConstant(b);
    case "bracketLookup":
      return {
        kind: "todo",
        reason:
          "bracketLookup translation not implemented yet — typically progressive-bracket math (AMT, ≥$100k Tax Computation Worksheet)",
      };
    case "unsupported":
      // Caller routes unsupported via the `unsupported` map; this shouldn't run.
      return { kind: "todo", reason: "unsupported routed to bindings path" };
  }
}

function translateLookupFact(b: ClassifiedBinding): Translation {
  const factKey = String(b.params.factKey ?? "");
  const slot = FACT_TO_SLOT[factKey];
  if (!slot) {
    return {
      kind: "todo",
      reason: `no FilingInfo slot for fact "${factKey}". Add the slot to BaseFilingInfo / <Form>FilingInfo and map it in renderBindings.FACT_TO_SLOT.`,
    };
  }
  return { kind: "body", body: `(_, info) => info.${slot}` };
}

function translateSumFacts(b: ClassifiedBinding): Translation {
  const category = String(b.params.category ?? "");
  const keyPrefix = String(b.params.keyPrefix ?? "");
  const fieldPath = String(b.params.fieldPath ?? "");
  const key = `${category}|${keyPrefix}|${fieldPath}`;
  const slot = SUM_FACTS_TO_SLOT[key];
  if (!slot) {
    return {
      kind: "todo",
      reason: `no FilingInfo slot for sumFacts(${key}). Add the aggregate to <Form>FilingInfo + the resolver, and map it in renderBindings.SUM_FACTS_TO_SLOT.`,
    };
  }
  return { kind: "body", body: `(_, info) => info.${slot}` };
}

function translateLookupDecision(b: ClassifiedBinding): Translation {
  const decisionKey = String(b.params.decisionKey ?? "");
  const slot = DECISION_TO_SLOT[decisionKey];
  if (!slot) {
    return {
      kind: "todo",
      reason: `no FilingInfo slot for decision "${decisionKey}". Add the slot to BaseFilingInfo / <Form>FilingInfo and map it in renderBindings.DECISION_TO_SLOT.`,
    };
  }
  return { kind: "body", body: `(_, info) => info.${slot}` };
}

function translateDecisionIfEquals(b: ClassifiedBinding): Translation {
  const decisionKey = String(b.params.decisionKey ?? "");
  const slot = DECISION_TO_SLOT[decisionKey];
  if (!slot) {
    return {
      kind: "todo",
      reason: `no FilingInfo slot for decision "${decisionKey}".`,
    };
  }
  const matchValue = b.params.matchValue;
  if (matchValue === undefined) {
    // Mode 1 — pass through the raw decision value (single_select / multi_select).
    return { kind: "body", body: `(_, info) => info.${slot}` };
  }
  // Mode 2 — per-checkbox boolean: true when decision === matchValue.
  // JSON.stringify preserves boolean/number/string typing so the comparison
  // operand matches the FilingInfo slot's type (boolean === boolean, not
  // boolean === "true"). The AI sometimes emits matchValue as the literal
  // `true` / `false`, sometimes the string "true" / "false" — keep both
  // working by normalizing matchValues that LOOK boolean back to booleans.
  const normalized =
    matchValue === "true"
      ? true
      : matchValue === "false"
        ? false
        : matchValue;
  return {
    kind: "body",
    body: `(_, info) => info.${slot} === ${JSON.stringify(normalized)}`,
  };
}

function translateTableLookupByDecision(b: ClassifiedBinding): Translation {
  const decisionKey = String(b.params.decisionKey ?? "");
  const slot = DECISION_TO_SLOT[decisionKey];
  if (!slot) {
    return {
      kind: "todo",
      reason: `no FilingInfo slot for decision "${decisionKey}".`,
    };
  }
  const table = b.params.table;
  if (!table || typeof table !== "object") {
    return { kind: "todo", reason: "tableLookupByDecision missing table param" };
  }
  const tableLiteral = JSON.stringify(table);
  return {
    kind: "body",
    body: `(_, info) => (info.${slot} ? (${tableLiteral} as Record<string, number>)[info.${slot}] : undefined)`,
  };
}

function translateFromFields(
  b: ClassifiedBinding,
  formId: string,
): Translation {
  const terms = b.params.terms as
    | Array<{ fieldId: string; sign?: number; whenSourceNotRequired?: unknown }>
    | undefined;
  if (!Array.isArray(terms) || terms.length === 0) {
    return { kind: "todo", reason: "fromFields missing terms" };
  }
  const args: string[] = [];
  for (const t of terms) {
    const sign = t.sign ?? 1;
    const key = shortOrFullKey(t.fieldId, formId);
    if (sign === 1) {
      args.push(`f[${quote(key)}]`);
    } else if (sign === -1) {
      // sum() takes (number | undefined); negate at the type level by wrapping.
      args.push(`f[${quote(key)}] === undefined ? 0 : -f[${quote(key)}]`);
    } else {
      args.push(`f[${quote(key)}] === undefined ? 0 : ${sign} * f[${quote(key)}]`);
    }
  }
  const sumExpr = `sum(${args.join(", ")})`;
  const floorVal = b.params.floor;
  if (typeof floorVal === "number") {
    return {
      kind: "body",
      body: `(f) => floor(${floorVal}, ${sumExpr})`,
      usesSum: true,
      usesFloor: true,
    };
  }
  return { kind: "body", body: `(f) => ${sumExpr}`, usesSum: true };
}

function translateTaxTable(b: ClassifiedBinding, formId: string): Translation {
  const decisionKey = String(b.params.decisionKey ?? "");
  const inputFieldId = String(b.params.inputFieldId ?? "");
  const tableId = String(b.params.tableId ?? "federal-2025");
  const slot = DECISION_TO_SLOT[decisionKey];
  if (!slot) {
    return {
      kind: "todo",
      reason: `taxTable: no FilingInfo slot for decision "${decisionKey}".`,
    };
  }
  if (!inputFieldId) {
    return { kind: "todo", reason: "taxTable missing inputFieldId" };
  }
  const inputKey = shortOrFullKey(inputFieldId, formId);
  return {
    kind: "body",
    body:
      `(f, info) => {\n` +
      `        if (!info.${slot}) return undefined;\n` +
      `        const income = f[${quote(inputKey)}];\n` +
      `        if (typeof income !== "number") return undefined;\n` +
      `        const r = lookupTax(${quote(tableId)}, income, info.${slot});\n` +
      `        return r.ok ? r.tax : undefined;\n` +
      `      }`,
    usesLookupTax: true,
  };
}

function translateConstant(b: ClassifiedBinding): Translation {
  const value = b.params.value;
  if (value === undefined) {
    return { kind: "todo", reason: "constant missing value param" };
  }
  return { kind: "body", body: `() => ${JSON.stringify(value)}` };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const CONFIDENCE_ORDER: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function shortKey(fieldId: string, formId: string): string {
  const prefix = `${formId}.`;
  if (fieldId.startsWith(prefix)) return fieldId.slice(prefix.length);
  return fieldId;
}

/**
 * For cross-form refs use the full fieldId so the form accessor proxy
 * routes through the global registry. For same-form refs use the short
 * key — that's the convention defineForm uses for its own fields.
 */
function shortOrFullKey(fieldId: string, formId: string): string {
  if (fieldId.startsWith(`${formId}.`)) return fieldId.slice(formId.length + 1);
  return fieldId;
}

function quote(s: string): string {
  return JSON.stringify(s);
}

/**
 * Compute an ESM-friendly relative import path from `fromFilePath` to
 * `toFilePath`, both relative to a known anchor (the agent's project root).
 * Strips the `.ts` extension and substitutes `.js` so the runtime resolver
 * works under tsx + the compiled output.
 */
function relImport(fromFilePath: string, toRelativePath: string): string {
  // toRelativePath is "src/mastra/forms/engine.ts" — turn into an absolute
  // path under the same root as fromFilePath.
  const fromAbs = fromFilePath;
  const matchRoot = fromAbs.match(/^(.*?)(\/apps\/agent\/)/);
  const projectRoot = matchRoot
    ? `${matchRoot[1]}${matchRoot[2]}`.replace(/\/$/, "")
    : process.cwd();
  const toAbs = `${projectRoot}/${toRelativePath}`;
  let rel = relative(dirname(fromAbs), toAbs);
  rel = rel.replace(/\.ts$/, ".js");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}
