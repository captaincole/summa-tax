// Copy form template PDFs (`forms/**/blank.pdf`) into the Vercel Build
// Output API function directory so they're shipped as part of the Lambda.
//
// Why:
//   - The Mastra Vercel deployer doesn't expose `includeFiles` on the
//     VercelDeployer constructor (only maxDuration / memory / regions
//     pass through — see node_modules/@mastra/deployer-vercel/dist/types).
//   - Vercel's Build Output API treats files inside the function dir as
//     bundled-in: anything under .vercel/output/functions/<name>.func/
//     gets extracted to /var/task/ in the Lambda.
//   - PDFs can't be statically imported the way catalog.json is — they're
//     binary, pdf-lib wants a Buffer at fillFromCatalog time, and Rollup
//     would need a binary-asset plugin we don't want to wire up.
//
// Runs as the last step of `mastra build` via apps/agent/package.json's
// "build" script. Idempotent — re-running just overwrites existing copies.

import { cp, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const repoFormsDir = resolve(process.cwd(), "forms");
const outputFunctionsDir = resolve(process.cwd(), ".vercel/output/functions");

async function findFunctionDirs(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name.endsWith(".func"))
    .map((e) => join(root, e.name));
}

async function findPdfs(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name === "blank.pdf") out.push(full);
    }
  }
  await walk(root);
  return out;
}

async function main(): Promise<void> {
  if (!existsSync(repoFormsDir)) {
    throw new Error(`[copy-form-pdfs] forms dir not found at ${repoFormsDir}`);
  }

  const funcDirs = await findFunctionDirs(outputFunctionsDir);
  if (funcDirs.length === 0) {
    throw new Error(
      `[copy-form-pdfs] no .func directories under ${outputFunctionsDir}. ` +
        `Run \`mastra build\` first — this script piggy-backs on its output.`,
    );
  }

  const pdfs = await findPdfs(repoFormsDir);
  if (pdfs.length === 0) {
    console.warn(`[copy-form-pdfs] no blank.pdf files found under ${repoFormsDir}`);
    return;
  }

  let totalBytes = 0;
  for (const funcDir of funcDirs) {
    for (const src of pdfs) {
      const rel = relative(process.cwd(), src);
      const dest = join(funcDir, rel);
      await cp(src, dest, { recursive: false });
      const { size } = await stat(dest);
      totalBytes += size;
    }
  }
  const mb = (totalBytes / 1024 / 1024).toFixed(2);
  console.log(
    `[copy-form-pdfs] copied ${pdfs.length} PDF(s) × ${funcDirs.length} function dir(s) (${mb} MB total)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
