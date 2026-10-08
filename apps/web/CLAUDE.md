# apps/web — Claude notes

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Generated files — do not edit, do not commit

- `next-env.d.ts` — Next.js regenerates it on every `next dev` / `next build`. It pulls Next.js global types (CSS modules, static images, typed routes) into the TypeScript program. Gitignored. Do not edit or delete it; a delete causes type errors until the next build regenerates it.
- `tsconfig.tsbuildinfo` — TypeScript incremental-compile cache. Gitignored. Safe to delete; the next compile recreates it. Delete it if `tsc` results look stale.
- `.next/` — build output, gitignored.

## File conventions

- This file replaced `AGENTS.md` (2026-10-08). If a Next.js upgrade regenerates `AGENTS.md`, merge any changed `nextjs-agent-rules` block into this file and delete it again.
