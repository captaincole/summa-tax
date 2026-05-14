// Render one PDF page to a PNG with numbered overlay rectangles drawn over
// each widget's bounding box. The output is the image we send to Claude
// vision so it can pair each numbered badge to the form text adjacent to it.
//
// Coordinate handling: pdf.js's `viewport.convertToViewportPoint(x, y)`
// converts a PDF-space point (origin bottom-left, y-up) to canvas space
// (origin top-left, y-down) and applies the page's scale factor. We use it
// for both corners of the widget rect and take the min/max to get a
// canvas-space bounding box that's stable regardless of rect orientation.

import { renderPageAsImage } from "unpdf";
import { createCanvas, loadImage } from "@napi-rs/canvas";

export interface OverlayWidget {
  /** Badge number drawn on the page; must be unique within the page. */
  id: number;
  /** Widget bounding box in PDF page coordinates: [x1, y1, x2, y2]. */
  rect: [number, number, number, number];
}

export interface RenderedPage {
  /** PNG bytes ready for Anthropic image input. */
  png: Buffer;
  /** Final image width in pixels. */
  width: number;
  /** Final image height in pixels. */
  height: number;
  /** Scale factor applied (e.g. 2.0). */
  scale: number;
}

export async function renderPageWithOverlay(opts: {
  /** A pdf.js PDFDocumentProxy (e.g. from unpdf's getDocumentProxy). */
  pdf: any;
  /** 0-indexed page number. */
  pageIndex: number;
  /** Widgets to overlay on the page. */
  widgets: OverlayWidget[];
  /** Render scale; higher = larger image. Default 2.0 (good legibility, modest tokens). */
  scale?: number;
}): Promise<RenderedPage> {
  const scale = opts.scale ?? 2.0;
  const page = await opts.pdf.getPage(opts.pageIndex + 1);
  const viewport = page.getViewport({ scale });

  const pageImageBuf = await renderPageAsImage(opts.pdf, opts.pageIndex + 1, {
    scale,
    canvasImport: () => import("@napi-rs/canvas"),
  });

  const img = await loadImage(Buffer.from(pageImageBuf));

  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  for (const w of opts.widgets) {
    const [x1, y1, x2, y2] = w.rect;
    const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
    const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);
    const left = Math.min(vx1, vx2);
    const top = Math.min(vy1, vy2);
    const width = Math.abs(vx2 - vx1);
    const height = Math.abs(vy2 - vy1);

    const pad = 1;
    ctx.strokeStyle = "rgba(220, 30, 30, 0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      left - pad,
      top - pad,
      width + pad * 2,
      height + pad * 2,
    );

    // Draw the number badge INSIDE the widget rectangle (top-left corner).
    // Placing the badge above-the-widget put it in the label space, which
    // made vision models confuse "badge over text X above widget Y" with
    // "badge labels widget Y, whose actual label is text Z below." Inside
    // the rectangle, the badge is unambiguously part of the widget — and
    // the form text outside the rectangle is unambiguously the label.
    const badge = String(w.id);
    ctx.font = "bold 13px sans-serif";
    const m = ctx.measureText(badge);
    const badgeW = Math.max(18, m.width + 8);
    const badgeH = Math.min(16, Math.max(12, height - 2));
    const badgeX = left;
    const badgeY = top;

    ctx.fillStyle = "rgba(220, 30, 30, 0.92)";
    ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    ctx.fillStyle = "white";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(badge, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);
  }

  return {
    png: canvas.toBuffer("image/png"),
    width: viewport.width,
    height: viewport.height,
    scale,
  };
}
