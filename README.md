# Summa

A self-hosted AI tax assistant. **Luca**, the agent, runs a conversational tax
intake — capturing facts with citations, flagging judgment calls, grounding
them against IRS instructions, and rendering draft forms (1040, CA 540, and
friends) as PDFs. The web app is the case file: progress, open questions,
documents in and out.

Single user per instance. No external services — your tax data lives in
SQLite files on your machine; the only network calls are the agent's LLM
requests to Anthropic (and optionally Voyage AI for semantic retrieval).

> **Status:** work in progress, narrow scenario coverage (single CA filer,
> W-2 + investment income). Not tax advice; a CPA should review anything
> this produces.

## Architecture

Two processes, one contract: the database. The browser only ever talks to
the web app; the agent sits on localhost behind a server-side proxy.

```mermaid
flowchart TB
    User(["👤 Owner"])

    subgraph machine["Your machine"]
        subgraph web["Web app · :3000 (Next.js)"]
            Gate["Password gate<br/>(first-run /setup → session cookie)"]
            CaseFile["Case file UI<br/>progress · activity · documents"]
            Chat["Chat pane"]
            Proxy["/api/agent proxy"]
        end

        subgraph agent["Agent · :4111 (Mastra)"]
            Luca["Luca<br/>conversational intake"]
            Engine["Form engine<br/>draft 1040 / 540 PDFs"]
            Grounding["Grounding<br/>decisions vs IRS corpus"]
        end

        subgraph data[".data/ (SQLite + files)"]
            AppDB[("app.db<br/>facts · decisions · filings")]
            MastraDB[("mastra.db<br/>chat threads · memory")]
            CorpusDB[("corpus.db<br/>IRS reference corpus")]
            Docs[("documents/<br/>uploaded + generated PDFs")]
        end
    end

    Anthropic["Anthropic API"]
    Voyage["Voyage AI<br/>(optional)"]

    User -->|session cookie| Gate
    Gate --> CaseFile
    Gate --> Chat
    Chat --> Proxy
    Proxy -->|localhost| Luca

    CaseFile <--> AppDB
    CaseFile <--> Docs

    Luca <--> AppDB
    Luca <--> MastraDB
    Engine --> Docs
    Grounding <--> CorpusDB

    Luca -->|LLM calls| Anthropic
    Grounding -.->|embeddings + rerank| Voyage
```

- **Web app** — password-gated case file over the shared DB, plus the chat
  pane. All agent traffic rides the session cookie through the same-origin
  proxy; the browser never holds an agent credential.
- **Agent** — the application: runs the intake conversation, evaluates the
  reactive form engine after every fact, grounds AI judgment calls against
  ingested IRS instructions, renders PDFs.
- **`.data/`** — everything persistent. Copy the directory, you've backed up
  the instance. Delete it (`npm run reset` preserves the corpus), you've
  factory-reset it.

## Quickstart

```bash
npm run install:all
cp apps/agent/.env.example apps/agent/.env.development   # add ANTHROPIC_API_KEY
cp apps/web/.env.example apps/web/.env.development       # set the .data paths
npm run dev:all
```

Open http://localhost:3000 — first run redirects to `/setup` to create your
owner account. `npm run reset` factory-resets user data (keeps the reference
corpus).

## Development

See `CLAUDE.md` for the full development guide and `OPEN_SOURCE_TRANSITION.md`
for the roadmap. Tests: `npm test` (golden-PDF scenario suite) and
`npm --prefix apps/agent run test:unit`.

## License

AGPL-3.0 — see `LICENSE`.
