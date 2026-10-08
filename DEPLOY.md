# Deploying Summa

Summa is a single-user app: one owner, one box, tax data in local files.
Deploy it like you'd deploy a personal tool, not a SaaS.

## Local (development or daily use)

```bash
npm run install:all
npm run dev:all          # generates .env.development files on first run
# → set ANTHROPIC_API_KEY in apps/agent/.env.development
npm run corpus -- fetch  # prebuilt IRS reference corpus
```

Open http://localhost:3000 → `/setup`. Everything persistent lives in
`apps/agent/.data/` — back it up by copying the directory.

## Docker (a VPS or home server)

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build -d
```

- Only the web app (`:3000`) is published; the agent stays on the compose
  network, reachable solely through the web app's server-side proxy.
- State lives in `./data` on the host — that directory is the whole backup.
- The agent container seeds the corpus on first start (release asset or a
  `corpus.db` you place in `./data` beforehand).

## Exposure & security posture

This app holds **SSNs and tax documents**. The auth gate is one password
(set at `/setup`) — deliberately simple, so treat network exposure
accordingly:

- **Best:** don't expose it. Run on localhost, or reach a home server over
  **Tailscale/WireGuard** — then the password is defense in depth, not the
  perimeter.
- If you must expose it publicly: put it behind TLS (Caddy/Traefik/nginx),
  and consider `AGENT_API_TOKEN` (agent env + web env) so even
  network-adjacent processes can't hit the agent port unauthenticated.
- Your tax data leaves the box only as LLM calls to Anthropic (and Voyage,
  if configured). No other third parties.

## What about serverless (Vercel etc.)?

Not supported since the local-files architecture landed — SQLite files and
document blobs need a persistent disk, and split web/agent deployments
can't share one. A small always-on box (Fly machine with a volume, a
Hetzner/DO VPS, a Raspberry Pi on your shelf) is the intended shape.
