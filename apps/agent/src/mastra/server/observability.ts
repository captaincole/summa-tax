import {
  Observability,
  ConsoleExporter,
  DefaultExporter,
} from "@mastra/observability";

// ConsoleExporter dumps full agent input/output (including base64-encoded
// user uploads) to stdout — useful for local debugging, prohibitive in
// Render logs. We keep it on only when MASTRA_DEV is set; DefaultExporter
// continues to write traces to observability storage in both environments,
// and Mastra Studio reads from there.
export function createObservability(): Observability {
  return new Observability({
    configs: {
      default: {
        serviceName: "wheel-of-time",
        exporters: process.env.MASTRA_DEV
          ? [new ConsoleExporter(), new DefaultExporter()]
          : [new DefaultExporter()],
      },
    },
  });
}
