// Generic "fetch-once, cache-on-disk" helper for HTML sources we ingest into
// structured JSON (tax tables, EIC tables, standard-deduction worksheets,
// etc.). The cached HTML is checked into the repo alongside the JSON output
// as provenance — if anyone questions a number later, we have a frozen copy
// of exactly what the source served on the date we ingested it.
//
// Usage:
//   const { html, source } = await fetchHtml({
//     url: "https://www.irs.gov/publications/p17",
//     cachePath: ".../tax-table-2025.source.html",
//   });
//
// Pass refresh=true to bypass the cache and re-fetch (e.g. when validating
// that the upstream hasn't changed since we last ingested).

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export interface SourceProvenance {
  url: string;
  fetchedAt: string;
  sha256: string;
  cacheFile: string;
}

export interface FetchHtmlResult {
  html: string;
  source: SourceProvenance;
  cached: boolean;
}

export async function fetchHtml(opts: {
  url: string;
  cachePath: string;
  refresh?: boolean;
}): Promise<FetchHtmlResult> {
  const { url, cachePath, refresh = false } = opts;
  const abs = path.resolve(cachePath);

  if (!refresh) {
    try {
      const html = await fs.readFile(abs, "utf8");
      const sha = sha256(html);
      const stat = await fs.stat(abs);
      return {
        html,
        cached: true,
        source: {
          url,
          fetchedAt: stat.mtime.toISOString(),
          sha256: sha,
          cacheFile: path.basename(abs),
        },
      };
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw err;
      // fall through to network fetch
    }
  }

  const res = await fetch(url, {
    headers: {
      // Pretend to be a real browser; irs.gov sometimes 403s default UAs.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10157) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`fetchHtml: ${url} → HTTP ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const sha = sha256(html);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, html, "utf8");
  return {
    html,
    cached: false,
    source: {
      url,
      fetchedAt: new Date().toISOString(),
      sha256: sha,
      cacheFile: path.basename(abs),
    },
  };
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
