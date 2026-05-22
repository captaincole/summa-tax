// Single source of truth for the agent's "project root" path. Resolves to:
//
//   - npm test / scripts:*       → cwd = apps/agent/   (npm sets cwd to package dir)
//   - `mastra dev`                → cwd = apps/agent/src/mastra/public  (mastra's
//                                   worker treats src/mastra/public as the runtime
//                                   asset root — we strip the suffix below to get
//                                   back to apps/agent)
//   - Vercel Lambda               → cwd = /var/task/    (where the deploy lands)
//
// In each case, the agent's runtime assets (`forms/**`, draft scratch dirs)
// live directly under apps/agent (or /var/task in prod), so this resolver
// returns that root. Downstream code does `resolve(projectRoot, "forms/...")`
// and it works in every environment.

import { resolve } from "node:path";

const MASTRA_DEV_ASSET_SUFFIX_POSIX = "/src/mastra/public";
const MASTRA_DEV_ASSET_SUFFIX_WIN = "\\src\\mastra\\public";

function resolveProjectRoot(): string {
  const cwd = process.cwd();
  // mastra dev (1.7+) sets cwd to <agent>/src/mastra/public for the worker
  // running the bundle. Walk up three levels to get back to <agent>.
  if (
    cwd.endsWith(MASTRA_DEV_ASSET_SUFFIX_POSIX) ||
    cwd.endsWith(MASTRA_DEV_ASSET_SUFFIX_WIN)
  ) {
    return resolve(cwd, "..", "..", "..");
  }
  return cwd;
}

export const projectRoot = resolveProjectRoot();
