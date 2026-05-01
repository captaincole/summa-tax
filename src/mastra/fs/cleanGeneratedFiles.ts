import { readdirSync, unlinkSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DRAFTS_DIR } from "./draftsDir";

// Directories holding generated per-user artifacts that should be wiped
// alongside user-data tables. Path convention mirrors the DB `ref_*` rule:
// anything under `ref/` is reference data and survives resets; anything
// generated per-user gets wiped.
const GENERATED_DIRS = [DRAFTS_DIR];

export interface CleanResult {
  deleted: string[];
}

export function cleanGeneratedFiles(): CleanResult {
  const deleted: string[] = [];

  for (const dir of GENERATED_DIRS) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (!statSync(full).isFile()) continue;
      unlinkSync(full);
      deleted.push(full);
    }
  }

  return { deleted };
}
