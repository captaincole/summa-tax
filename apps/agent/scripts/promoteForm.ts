// Promote a form's runtime assets from the offline source-of-truth at
// apps/agent/forms/<sub>/ into the runtime tree at
// apps/agent/src/mastra/public/forms/<sub>/. The runtime tree is what
// gets bundled (catalog.json via Rollup static import) and shipped to
// /var/task on Vercel (blank.pdf via Mastra's copyPublic step).
//
// The promotion gate exists because ingesting a new catalog updates the
// offline tree first — tests run against it — and only after they pass
// should the change propagate to runtime. Without this, ingest churn
// would auto-ship on the next deploy.
//
// Usage:
//   npm run forms:promote -- federal/1040
//   npm run forms:promote -- state/ca/schedule-ca
//
// Pass the subpath under forms/ (matches FormSpec.relativeDir). Copies
// blank.pdf + catalog.json; everything else (instructions.*) stays
// offline-only because runtime doesn't read it.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const FILES = ["blank.pdf", "catalog.json"] as const;

function main() {
  const sub = process.argv[2];
  if (!sub) {
    console.error("usage: forms:promote <relativeDir>  (e.g. federal/1040)");
    process.exit(1);
  }

  const srcDir = resolve(process.cwd(), "forms", sub);
  const dstDir = resolve(process.cwd(), "src/mastra/public/forms", sub);

  if (!existsSync(srcDir)) {
    console.error(`[forms:promote] source not found: ${srcDir}`);
    process.exit(1);
  }
  mkdirSync(dstDir, { recursive: true });

  for (const file of FILES) {
    const src = resolve(srcDir, file);
    const dst = resolve(dstDir, file);
    if (!existsSync(src)) {
      console.error(`[forms:promote] missing source file: ${src}`);
      process.exit(1);
    }
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    console.log(`[forms:promote] ${sub}/${file}`);
  }
  console.log(`[forms:promote] done — ${sub}`);
}

main();
