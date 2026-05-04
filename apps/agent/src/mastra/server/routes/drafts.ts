import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { registerApiRoute } from "@mastra/core/server";
import { DRAFTS_DIR } from "../../fs/draftsDir";

// Serves generated draft PDFs. Public so <a href> clicks and iframe embeds
// work without an Authorization header — filenames are hard-to-guess and the
// demo is behind a passcode gate at the app level. Revisit if drafts ever
// contain real PII.
export const draftsRoute = registerApiRoute("/drafts/:filename", {
  method: "GET",
  requiresAuth: false,
  handler: async (c) => {
    const filename = basename(c.req.param("filename"));
    if (!filename.endsWith(".pdf")) {
      return c.json({ error: "Only .pdf files are served" }, 400);
    }
    const path = resolve(DRAFTS_DIR, filename);
    if (!path.startsWith(DRAFTS_DIR) || !existsSync(path)) {
      return c.json({ error: "Not found" }, 404);
    }
    const bytes = readFileSync(path);
    return c.body(bytes, 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    });
  },
});
