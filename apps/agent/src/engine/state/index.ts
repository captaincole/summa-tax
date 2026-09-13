// State composition — one import + one spread per supported state.
//
// Adding a state:
//   1. Create ./<st>/ with its forms (types.ts / filingInfo.ts / bindings.ts
//      per form), its index.ts exporting <ST>_FORMS + <ST>_CATALOGS, and its
//      data tables (rate schedules, standard deductions) under ./<st>/data/.
//   2. Add the import + spreads below. That's the whole diff outside ./<st>/.
//
// States may import from ../ (core) and read federal results cross-form,
// but never from each other — the boundary test enforces the first rule,
// review enforces the second.

import { CA_FORMS, CA_CATALOGS } from "./ca/index.js";
import type { FormSpec } from "../formSpec.js";

export const STATE_FORMS: FormSpec[] = [...CA_FORMS];
export const STATE_CATALOGS = [...CA_CATALOGS];
