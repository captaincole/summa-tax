import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordFact } from "../db/taxFacts";

// Ingest a W-2's structured data into tax_facts. In production this is
// the downstream target of OCR + normalization. For MVP, Thom calls it
// after collecting the W-2 boxes from the user (verbally or via the
// fixture), passing the values through.
//
// Writes all the facts the case engine expects, plus the scoping fact
// wages.has_w2_income=true and retirement.contribution_401k if a code-D
// entry exists in box 12.

const AddressSchema = z.object({
  line1: z.string(),
  line2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
});

export const ingestW2 = createTool({
  id: "ingest-w2-structured",
  description:
    "Ingest a W-2's structured data (all boxes) in one call. Writes the core W-2 facts (box 1–17, box 12 entries, box 13, box 14), marks wages.has_w2_income=true, and captures derived facts like the 401(k) contribution amount and CA SDI. Call this ONCE per W-2 after collecting all the values from the taxpayer.",
  inputSchema: z.object({
    taxpayerId: z.string(),
    year: z.number().int(),
    employer: z.object({
      name: z.string(),
      ein: z.string(),
      address: AddressSchema.optional(),
    }),
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
  }),
  execute: async (input) => {
    const { taxpayerId, year, sourceNote } = input;
    let count = 0;

    const write = async (category: string, key: string, value: unknown) => {
      await recordFact({
        id: crypto.randomUUID(),
        taxpayerId,
        year,
        category,
        key,
        value,
        sourceNote,
      });
      count++;
    };

    // Scoping fact — flips W-2 source-doc scope to in_scope.
    await write("wages", "wages.has_w2_income", true);
    await write("wages", "wages.w2_count", 1);

    // Employer
    await write("wages", "w2.employer.name", input.employer.name);
    await write("wages", "w2.employer.ein", input.employer.ein);
    if (input.employer.address) {
      await write("wages", "w2.employer.address", input.employer.address);
    }

    // Numbered boxes
    await write("wages", "w2.box1", input.box1);
    await write("wages", "w2.box2", input.box2);
    await write("wages", "w2.box3", input.box3);
    await write("wages", "w2.box4", input.box4);
    await write("wages", "w2.box5", input.box5);
    await write("wages", "w2.box6", input.box6);
    if (input.box7 !== undefined) await write("wages", "w2.box7", input.box7);
    if (input.box8 !== undefined) await write("wages", "w2.box8", input.box8);
    if (input.box10 !== undefined) await write("wages", "w2.box10", input.box10);
    if (input.box11 !== undefined) await write("wages", "w2.box11", input.box11);

    // Box 12: both the raw entries and a normalized list of codes
    if (input.box12 && input.box12.length > 0) {
      await write("wages", "w2.box12_entries", input.box12);
      await write("wages", "w2.box12_codes", input.box12.map((e) => e.code));

      // Code D = 401(k) elective deferral — also a retirement fact
      const codeD = input.box12.find((e) => e.code === "D");
      if (codeD) {
        await write("retirement", "retirement.contribution_401k", codeD.amount);
      }
    }

    // Box 13 checkboxes
    if (input.box13) {
      if (input.box13.statutoryEmployee !== undefined)
        await write("wages", "w2.box13.statutory_employee", input.box13.statutoryEmployee);
      if (input.box13.retirementPlan !== undefined)
        await write("wages", "w2.box13.retirement_plan", input.box13.retirementPlan);
      if (input.box13.thirdPartySickPay !== undefined)
        await write("wages", "w2.box13.third_party_sick_pay", input.box13.thirdPartySickPay);
    }

    // Box 14 Other
    if (input.box14 && input.box14.length > 0) {
      await write("wages", "w2.box14_entries", input.box14);

      // CA SDI specifically — the deductions derivation looks for this key
      const caSdi = input.box14.find((e) =>
        /CA\s*SDI|VPDI|SDI/i.test(e.label),
      );
      if (caSdi) {
        await write("state_local_tax", "w2.box14.ca_sdi", caSdi.amount);
      }
    }

    // State boxes
    await write("state_local_tax", "w2.box15", input.box15);
    await write("state_local_tax", "w2.box16", input.box16);
    await write("state_local_tax", "w2.box17", input.box17);

    return { factsWritten: count };
  },
});
