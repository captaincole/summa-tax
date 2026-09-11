import { createHash } from "node:crypto";
import type {
  Processor,
  ProcessInputArgs,
  ProcessInputStepArgs,
} from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/agent";
import { modelReadsPdf } from "../models";

// Claude reads PDF file parts natively; OpenAI-compatible servers (Ollama,
// vLLM, LM Studio, …) accept images only — a PDF part makes the AI SDK throw
// AI_UnsupportedFunctionalityError before the request even leaves. This
// processor rasterizes PDF attachments to one PNG per page so document
// reading keeps working when LUCA_MODEL points at a local model.
//
// It runs at processInput (the new user message) AND processInputStep (the
// full per-step message list) because thread history replays older messages
// that never went through processInput — a PDF uploaded three turns ago
// would otherwise crash every later turn. Rasterization is cached by content
// hash, so each PDF is rendered once per process lifetime.

const MAX_PAGES = 8;
// 1.5× the 72dpi base ≈ 108dpi — enough to read W-2 box numbers without
// blowing up the request payload (each page ≈ 150-400 KB of PNG).
const SCALE = 1.5;

type FilePart = { type: "file"; mimeType?: string; data?: unknown };

function isPdfPart(part: unknown): part is FilePart & { data: string } {
  const p = part as FilePart;
  return (
    p?.type === "file" &&
    typeof p.data === "string" &&
    (p.mimeType === "application/pdf" ||
      p.data.startsWith("data:application/pdf"))
  );
}

function rawBase64(data: string): string {
  return data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
}

const pageCache = new Map<string, string[]>();

async function pdfToPngPages(base64: string): Promise<string[]> {
  const key = createHash("sha1").update(base64).digest("hex");
  const hit = pageCache.get(key);
  if (hit) return hit;

  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  const doc = await getDocumentProxy(bytes);
  const pages = Math.min(doc.numPages, MAX_PAGES);
  const out: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const png = await renderPageAsImage(doc, page, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: SCALE,
    });
    out.push(Buffer.from(png as ArrayBuffer).toString("base64"));
  }
  pageCache.set(key, out);
  return out;
}

async function rasterizePdfParts(
  messages: MastraDBMessage[],
): Promise<MastraDBMessage[] | undefined> {
  let changed = false;
  const result = await Promise.all(
    messages.map(async (msg) => {
      const parts = msg.content?.parts as unknown[] | undefined;
      if (!parts?.some(isPdfPart)) return msg;
      changed = true;

      const newParts: unknown[] = [];
      for (const part of parts) {
        if (!isPdfPart(part)) {
          newParts.push(part);
          continue;
        }
        const pngs = await pdfToPngPages(rawBase64(part.data));
        const name =
          (part as { filename?: string }).filename ?? "attached PDF";
        newParts.push({
          type: "text",
          text: `[${name} — rendered as ${pngs.length} page image(s)${
            pngs.length === MAX_PAGES ? "; longer documents are truncated" : ""
          }]`,
        });
        for (const png of pngs) {
          newParts.push({ type: "file", mimeType: "image/png", data: png });
        }
      }
      return {
        ...msg,
        content: { ...msg.content, parts: newParts },
      } as MastraDBMessage;
    }),
  );
  return changed ? result : undefined;
}

export class PdfAttachmentRasterizer implements Processor {
  readonly id = "pdf-attachment-rasterizer";
  readonly description =
    "Rasterizes PDF attachments to PNG pages for models without native PDF input";

  async processInput({ messages }: ProcessInputArgs) {
    if (modelReadsPdf("luca")) return messages;
    return (await rasterizePdfParts(messages)) ?? messages;
  }

  async processInputStep({ messages }: ProcessInputStepArgs) {
    if (modelReadsPdf("luca")) return;
    return await rasterizePdfParts(messages);
  }
}
