// Promote a form's runtime assets from the offline source-of-truth at
// apps/agent/forms/<sub>/ into the runtime tree at
// apps/agent/src/mastra/public/forms/<sub>/. The runtime tree is what
// gets bundled (catalog.json via Rollup static import) and shipped to
// /var/task on Vercel (blank.pdf via Mastra's copyPublic step).
//
// The promotion gate exists because generating a new catalog updates the
// offline tree first — tests run against it — and only after they pass
// should the change propagate to runtime. Without this, catalog churn
// would auto-ship on the next deploy.
//
// Copies blank.pdf + catalog.json; everything else (instructions.*) stays
// offline-only because runtime doesn't read it.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { projectRoot } from "../../src/paths.js";
import type { Command } from "../lib/cli";

const FILES = ["blank.pdf", "catalog.json"] as const;

async function run(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (!sub) {
    console.error("required: <relativeDir> under forms/, e.g. federal/1040 or state/ca/schedule-ca");
    process.exit(1);
  }

  const srcDir = resolve(projectRoot, "forms", sub);
  const dstDir = resolve(projectRoot, "src/mastra/public/forms", sub);

  if (!existsSync(srcDir)) {
    console.error(`[promote] source not found: ${srcDir}`);
    process.exit(1);
  }
  mkdirSync(dstDir, { recursive: true });

  for (const file of FILES) {
    const src = resolve(srcDir, file);
    const dst = resolve(dstDir, file);
    if (!existsSync(src)) {
      console.error(`[promote] missing source file: ${src}`);
      process.exit(1);
    }
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    console.log(`[promote] ${sub}/${file}`);
  }
  console.log(`[promote] done — ${sub}`);
}

export const promoteCommand: Command = {
  name: "promote",
  summary: "Copy a form's vetted blank.pdf + catalog.json into the runtime tree",
  usage: "<relativeDir>   (subpath under forms/, e.g. federal/1040)",
  run,
};
