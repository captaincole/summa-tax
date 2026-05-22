// Single source of truth for the agent's "project root" path. Resolves to:
//
//   - `mastra dev` / npm scripts → cwd = apps/agent/   (where the agent lives)
//   - npm test / scripts:*       → cwd = apps/agent/   (npm sets cwd to package dir)
//   - Vercel Lambda              → cwd = /var/task/    (where the deploy lands)
//
// Each of those has the agent's runtime assets (`forms/**`, draft scratch
// dirs) directly underneath, so `resolve(projectRoot, "forms/...")` works
// in every environment.
//
// We previously used `import.meta.url` math (two `..` hops from this
// file's dirname), which assumed the bundled `mastra.mjs` would land at
// `<project>/.mastra/output/`. Vercel flattens the bundle to
// `/var/task/mastra.mjs`, so two `..` hops clamped at `/` and every
// filesystem read produced a confusing ENOENT at `/forms/...`. Using
// `process.cwd()` directly avoids the brittleness — it's the same value
// in dev, test, and prod given how we invoke the agent.
//
// Assumption: don't `process.chdir()` and don't invoke scripts from
// arbitrary directories. If you `cd /tmp && npx tsx scripts/foo.ts`,
// projectRoot will be `/tmp` and downstream fs reads will fail loudly.
// Run scripts via `npm run <name>` (which sets cwd correctly).

export const projectRoot = process.cwd();
