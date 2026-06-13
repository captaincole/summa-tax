import {
  Observability,
  ConsoleExporter,
  DefaultExporter,
} from "@mastra/observability";
import {
  type AnyExportedSpan,
  type CustomSpanFormatter,
} from "@mastra/core/observability";

// ConsoleExporter dumps the full span (input, output, attributes) every
// time a span starts / ends / updates. Luca's multi-KB system prompt and
// base64-encoded uploads end up in that dump, making the dev terminal
// unusable. We pipe spans through a whitelist filter first — only the
// listed keys survive at any depth. Anything Mastra adds in a future
// version that isn't on the list gets dropped automatically.
//
// DefaultExporter still writes the full, unstripped trace to observability
// storage; Mastra Studio reads from there if you need the rest.

// Single flat union of keys we want to see anywhere they appear in a span.
// Add a key here to surface it; remove one to suppress.
const ALLOW_KEYS = new Set([
  // Span identity / timing
  "id",
  "type",
  "name",
  "startTime",
  "endTime",
  "traceId",
  "parentSpanId",
  "isRootSpan",
  // Error info (SpanErrorInfo fields)
  "errorInfo",
  "message",
  "stack",
  "details",
  "domain",
  "category",
  // Span payload
  "input",
  "output",
  // Message envelope + parts
  "messages",
  "role",
  "content",
  "text",
  // Common output fields
  "warnings",
  "reasoning",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function filter(value: unknown): unknown {
  if (Array.isArray(value)) {
    // Inside any messages array, drop role:'system' entries — they carry
    // the system prompt. Other roles (user, assistant, tool) keep going.
    return value
      .filter(
        (item) =>
          !(
            item &&
            typeof item === "object" &&
            (item as { role?: unknown }).role === "system"
          ),
      )
      .map(filter);
  }
  if (isPlainObject(value)) {
    // Whitelist: only keep keys in ALLOW_KEYS; recurse into their values.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!ALLOW_KEYS.has(k)) continue;
      out[k] = filter(v);
    }
    return out;
  }
  // Primitives + class instances (Date, etc.) — pass through.
  return value;
}

const formatSpan: CustomSpanFormatter = (span) => {
  return filter(span) as AnyExportedSpan;
};

export function createObservability(): Observability {
  const isDev = process.env.MASTRA_DEV === "true";
  return new Observability({
    configs: {
      default: {
        serviceName: "summa",
        exporters: isDev
          ? [
              new ConsoleExporter({ customSpanFormatter: formatSpan }),
              new DefaultExporter(),
            ]
          : [new DefaultExporter()],
      },
    },
  });
}
