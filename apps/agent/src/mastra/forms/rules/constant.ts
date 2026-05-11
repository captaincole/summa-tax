import { z } from "zod";
import { ok } from "../types.js";
import { rule } from "../engine.js";

export const constant = rule({
  name: "constant",
  paramsSchema: z.object({
    value: z.unknown(),
    rationale: z.string(),
  }),
  evaluate: (p) => ok(p.value, p.rationale, []),
});
