import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { resolve, join, relative } from "node:path";

// Walks reference-docs/**/*.pdf and pairs each PDF with its sibling
// `<basename>.meta.json` sidecar. The sidecar is the source of truth for
// docId/title/publisher/taxYear/sourceUrl; the filesystem is the source of
// truth for which docs *should* exist.
//
// A PDF without a sidecar is reported as `unconfigured` rather than silently
// skipped — adding a PDF without metadata is almost always a mistake.

export interface RefDocSidecar {
  docId: string;
  title: string;
  publisher: string;
  taxYear: number | null;
  sourceUrl: string | null;
}

export interface CorpusEntry {
  pdfPath: string; // absolute
  pdfRelPath: string; // relative to project root, for display
  sidecarPath: string; // absolute
  sidecar: RefDocSidecar;
  fileSha: string;
}

export interface WalkResult {
  entries: CorpusEntry[];
  unconfigured: { pdfPath: string; pdfRelPath: string; reason: string }[];
}

const REF_DOCS_DIR = "reference-docs";

async function walkPdfs(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkPdfs(full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      out.push(full);
    }
  }
  return out;
}

export async function walkCorpus(projectRoot: string): Promise<WalkResult> {
  const root = resolve(projectRoot);
  const refDir = join(root, REF_DOCS_DIR);
  const pdfPaths = await walkPdfs(refDir);

  const entries: CorpusEntry[] = [];
  const unconfigured: WalkResult["unconfigured"] = [];

  for (const pdfPath of pdfPaths) {
    const sidecarPath = pdfPath.replace(/\.pdf$/i, ".meta.json");
    let sidecarText: string;
    try {
      sidecarText = await readFile(sidecarPath, "utf8");
    } catch {
      unconfigured.push({
        pdfPath,
        pdfRelPath: relative(root, pdfPath),
        reason: `missing sidecar ${relative(root, sidecarPath)}`,
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(sidecarText);
    } catch (e) {
      unconfigured.push({
        pdfPath,
        pdfRelPath: relative(root, pdfPath),
        reason: `sidecar JSON parse error: ${(e as Error).message}`,
      });
      continue;
    }

    const sidecar = coerceSidecar(parsed);
    if (!sidecar) {
      unconfigured.push({
        pdfPath,
        pdfRelPath: relative(root, pdfPath),
        reason: "sidecar missing required fields (docId, title, publisher)",
      });
      continue;
    }

    const buf = await readFile(pdfPath);
    const fileSha = createHash("sha256").update(buf).digest("hex");

    entries.push({
      pdfPath,
      pdfRelPath: relative(root, pdfPath),
      sidecarPath,
      sidecar,
      fileSha,
    });
  }

  return { entries, unconfigured };
}

function coerceSidecar(v: unknown): RefDocSidecar | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.docId !== "string" ||
    typeof o.title !== "string" ||
    typeof o.publisher !== "string"
  ) {
    return null;
  }
  const taxYear = typeof o.taxYear === "number" ? o.taxYear : null;
  const sourceUrl = typeof o.sourceUrl === "string" ? o.sourceUrl : null;
  return {
    docId: o.docId,
    title: o.title,
    publisher: o.publisher,
    taxYear,
    sourceUrl,
  };
}
