import {
  Observability,
  ConsoleExporter,
  DefaultExporter,
} from "@mastra/observability";

// ConsoleExporter dumps full agent input/output (including base64-encoded
// user uploads) to stdout — useful for local debugging, prohibitive in
// production logs. We keep it on only when MASTRA_DEV === "true"; the
// explicit equality check guards against the JS gotcha that any non-empty
// string (including "false") is truthy. DefaultExporter continues to write
// traces to observability storage in both environments, and Mastra Studio
// reads from there.
export function createObservability(): Observability {
  const isDev = process.env.MASTRA_DEV === "true";
  return new Observability({
    configs: {
      default: {
        serviceName: "wheel-of-time",
        exporters: isDev
          ? [new ConsoleExporter(), new DefaultExporter()]
          : [new DefaultExporter()],
      },
    },
  });
}
