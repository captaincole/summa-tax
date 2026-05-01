import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordFact } from "../db/taxFacts";
import { makeW2FactKey, type W2FactValue } from "../facts";

// Ingest a W-2 as a single structured tax_facts row. The Form Engine reads
// these via `getW2Facts(facts)` from the fact catalog.
//
// Convention (see src/mastra/facts/kinds/wages.ts):
//   category: "wages"
//   key:      "employer.{employerSlug}"
//   value:    W2FactValue
//
// Thom (vision-capable) reads the W-2 PDF and calls this tool with the
// extracted values. The schema mirrors IRS-canonical box numbers so any
// W-2 layout maps to the same fields.

const AddressSchema = z.object({
  line1: z.string(),
  line2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
});

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const ingestW2 = createTool({
  id: "ingest-w2-structured",
  description:
    "Ingest a single W-2 as a structured tax fact. Thom (or whatever upstream extractor) reads the W-2 PDF and calls this with all the box values. Writes ONE tax_facts row with the full W-2 data; the Form Engine reads it via the fact catalog. Call once per W-2.",
  inputSchema: z.object({
    taxpayerId: z.string(),
    year: z.number().int(),
    employer: z.object({
      name: z.string(),
      ein: z.string(),
      address: AddressSchema.optional(),
    }),
    employee: z
      .object({
        firstName: z.string().describe("From W-2 box e (employee first name)"),
        middleInitial: z.string().optional(),
        lastName: z.string().describe("From W-2 box e (employee last name)"),
        suffix: z.string().optional(),
        ssn: z.string().describe("From W-2 box a (employee SSN, formatted ###-##-####)"),
        address: AddressSchema.optional().describe("From W-2 box f (employee mailing address)"),
      })
      .optional()
      .describe(
        "Employee identity from boxes a, e, and f of the W-2. Pass this whenever you can read it from the W-2 — the tool will also write identity.name.first / identity.name.last / identity.ssn / identity.address as facts so the form renderers can fill the personal-information boxes at the top of every form.",
      ),
    employerSlug: z
      .string()
      .optional()
      .describe(
        "Stable slug for this employer in the fact key. Defaults to slugified employer name; falls back to ein-based slug if name doesn't slugify cleanly.",
      ),
    box1: z.number().describe("Wages, tips, other compensation"),
    box2: z.number().describe("Federal income tax withheld"),
    box3: z.number().describe("Social security wages"),
    box4: z.number().describe("Social security tax withheld"),
    box5: z.number().describe("Medicare wages and tips"),
    box6: z.number().describe("Medicare tax withheld"),
    box7: z.number().optional().describe("Social security tips"),
    box8: z.number().optional().describe("Allocated tips"),
    box10: z.number().optional().describe("Dependent care benefits"),
    box11: z.number().optional().describe("Nonqualified plans"),
    box12: z
      .array(z.object({ code: z.string(), amount: z.number() }))
      .optional()
      .describe("Box 12 entries, each with an IRS code letter and dollar amount"),
    box13: z
      .object({
        statutoryEmployee: z.boolean().optional(),
        retirementPlan: z.boolean().optional(),
        thirdPartySickPay: z.boolean().optional(),
      })
      .optional(),
    box14: z
      .array(z.object({ label: z.string(), amount: z.number() }))
      .optional()
      .describe("Box 14 'Other' entries — employer-specific (e.g., CA SDI)"),
    box15: z.string().describe("State (two-letter abbreviation)"),
    box16: z.number().describe("State wages"),
    box17: z.number().describe("State income tax withheld"),
    sourceNote: z
      .string()
      .default("W-2 ingested via structured payload"),
  }),
  outputSchema: z.object({
    factsWritten: z.number(),
    employerSlug: z.string(),
    factKey: z.string(),
  }),
  execute: async (input) => {
    const { taxpayerId, year, sourceNote } = input;
    const slug =
      input.employerSlug ||
      slugify(input.employer.name) ||
      `ein-${input.employer.ein.replace(/-/g, "")}`;

    const w2: W2FactValue = {
      employerName: input.employer.name,
      employerEin: input.employer.ein,
      employerAddress: input.employer.address,
      employee: input.employee,
      box1: input.box1,
      box2: input.box2,
      box3: input.box3,
      box4: input.box4,
      box5: input.box5,
      box6: input.box6,
      box7: input.box7,
      box8: input.box8,
      box10: input.box10,
      box11: input.box11,
      box12: input.box12,
      box13: input.box13,
      box14: input.box14,
      box15: input.box15,
      box16: input.box16,
      box17: input.box17,
    };

    const factKey = makeW2FactKey(slug);
    await recordFact({
      id: crypto.randomUUID(),
      taxpayerId,
      year,
      category: "wages",
      key: factKey,
      value: w2,
      sourceNote,
    });
    let factsWritten = 1;

    // Side effect: copy employee identity (boxes a/e/f) into the
    // `identity.*` fact keys that PDF renderers read to fill the
    // personal-info boxes at the top of every form. The most recent write
    // wins, so a later user-stated correction will supersede this.
    if (input.employee) {
      const e = input.employee;
      const writeIdentity = async (key: string, value: unknown) => {
        if (value === undefined || value === null || value === "") return;
        await recordFact({
          id: crypto.randomUUID(),
          taxpayerId,
          year,
          category: "identity",
          key,
          value,
          sourceNote: `Auto-extracted from W-2 (${input.employer.name})`,
        });
        factsWritten++;
      };
      await writeIdentity("identity.name.first", e.firstName);
      await writeIdentity("identity.name.last", e.lastName);
      await writeIdentity("identity.ssn", e.ssn);
      if (e.address) await writeIdentity("identity.address", e.address);
    }

    return { factsWritten, employerSlug: slug, factKey };
  },
});
