// Single source of truth for the project-root absolute path. Everything that
// reads files from disk (form templates, ref PDFs, drafts dir) imports from
// here so dev (tsx, per-file import.meta.url) and prod (single bundled
// .mastra/output/mastra.mjs) agree.
//
// This file lives at src/mastra/paths.ts. In both environments, two `..`
// hops from its dirname land at the project root:
//   dev:  <project>/src/mastra/  → <project>
//   prod: <project>/.mastra/output/ → <project>
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
