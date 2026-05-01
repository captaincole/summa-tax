import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "../paths";

// Where user-generated artifacts (filled-out PDFs, forms sidecar JSON) get
// written. Override via $DRAFTS_DIR for ephemeral deploys (e.g. Render's
// persistent disk); otherwise we write into the dev server's public dir so
// Mastra serves them under /drafts.
//
// This is the single source of truth — both the route layer (which serves
// these files) and the cleanup helper (which wipes them on reset) read here.
export const DRAFTS_DIR = process.env.DRAFTS_DIR
  ? resolve(process.env.DRAFTS_DIR)
  : resolve(projectRoot, "src/mastra/public/drafts");

mkdirSync(DRAFTS_DIR, { recursive: true });
