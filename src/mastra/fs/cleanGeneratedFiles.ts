import { readdirSync, unlinkSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "../paths";

// Directories holding generated per-user artifacts that should be wiped
// alongside user-data tables. Path convention mirrors the DB `ref_*` rule:
// anything under `ref/` is reference data and survives resets; anything
// generated per-user gets wiped. Honors $DRAFTS_DIR so prod cleanup hits
// the Render persistent disk and not a stale src/mastra/public path.
const draftsDir = process.env.DRAFTS_DIR
  ? resolve(process.env.DRAFTS_DIR)
  : resolve(projectRoot, "src/mastra/public/drafts");
const GENERATED_DIRS = [draftsDir];

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
