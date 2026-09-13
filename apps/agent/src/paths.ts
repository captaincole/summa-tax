// "Project root" for offline tooling — tests, scripts, refdocs:* — that run
// with cwd at apps/agent/. The engine's runtime no longer imports this; it
// reads its assets via cwd-relative paths that work uniformly across
// `mastra dev` (cwd = src/mastra/public), Vercel (cwd = /var/task, populated
// by Mastra's copyPublic step), and npm scripts (cwd = apps/agent).

export const projectRoot = process.cwd();
