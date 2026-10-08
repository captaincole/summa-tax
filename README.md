# Summa by @captaincole — AI Can Do Your Taxes

Summa is a local-capable AI harness that allows you to build all the documents you need to either estimate or file your taxes. 

## Why? - Let's Break The System...

Taxes shouldn't be as hard as they are today. An entire industry profits from keeping the U.S. tax system difficult and opaque, but it doesn't have to be that way and this project is an attempt to change that system. 

I personally have suffered through the companies that provide tax products only to ask myself if there was a better way. You shouldn't have to pay a private company to help you figure out how much money you have to pay to the government!

This project was going to be a startup, but life changed directions. Now I want this to be a collaborative project that has the greatest impact it can. Join me in disrupting the tax cabal. 

## Table of Contents

- [What Is Summa?](#what-is-summa)
- [Scenario coverage](#scenario-coverage)
- [Before you use this — read honestly](#before-you-use-this--read-honestly)
- [Quick Start](#quick-start)
- [Contributing](#contributing)
- [Developer Guide](#developer-guide)
- [License](#license)

## What Is Summa?

Summa is a local-capable AI harness that allows you to build all the documents you need to either estimate or file your taxes. Summa is built with three distinct parts working together: a web app you talk to, an AI agent that turns the conversation into data, and a deterministic engine that turns the data into your return.

<p align="center">
  <img src="static/how-it-works.svg" alt="The Summa triangle — your words and documents go to Luca, Luca turns them into tax facts and decisions, the Form Engine computes the draft return and open questions, and the results flow back to you" width="640">
</p>

- **Web App (apps/web)** — where you live: type messages, store documents, watch your
  return take shape. This is your standard web application
- **Luca (apps/agent)** — the agent: interviews you, and reads the documents you upload
  (a W-2 PDF, a 1099, a photo of either) directly. From both it does two
  critical jobs. It records **tax facts**: verbatim pieces of data, each with
  a citation for where it came from (a document, a statement line, or "you
  told me, on this date").
  And it makes **decisions**: judgment calls where the facts are ambiguous —
  each one double-checked in the background against the actual IRS/FTB
  instruction text, which either cites the supporting passage or reopens the
  question. Numbers are never invented — an unknown becomes an open question,
  not a guess.
- **Form Engine (apps/agent/src/engine)** — a solver. Takes the facts and decisions and computes the
  draft 1040/540 by the tax rules — deterministic code, no AI anywhere in the
  math. Every new fact re-computes the return, so your draft updates live as
  you talk, and the open questions it surfaces are what Luca asks you next.

## Scenario coverage

Scenario coverage is the core way we verify that our engine works. Each scenario is reviewed by a CPA to ensure correctness, and when we want to add new capabilities to our engine we need to add new scenarios to cover those capabilities. 

State coverage is California-only today.

| Scenario | Federal | State (CA) |
| --- | --- | --- |
| Single filer, W-2 income | ✅ Supported | ✅ Supported |
| Interest + dividend income (1099-INT / 1099-DIV) | ✅ Supported | ✅ Supported |
| Standard deduction | ✅ Supported | ✅ Supported |
| Capital gains — brokerage stock sales (consolidated 1099-B, covered lots → Schedule D / 8949) | ✅ Supported | ✅ Supported |
| Capital gains — crypto (1099-DA), wash sales, non-covered lots | ❌ Not yet | ❌ Not yet |
| Itemized deductions (Schedule A) | ❌ Not yet | ❌ Not yet |
| Dependents, MFJ/MFS/HoH | ❌ Not yet | ❌ Not yet |
| Self-employment, K-1s, rental | ❌ Not yet | ❌ Not yet |

## Before you use this — read honestly

- **Your tax data goes to your model.** Every conversation turn, and every background grounding check, is an API call carrying your tax facts to the model you configured. If you use a local model, or spin up your own private infra you are fine, but if you use Anthropic or OpenAI just remember that. 
- **This is not tax advice.** Summa is in a beta state and at the moment
  produces *drafts*. Please double check the work with a CPA.
- **Coverage is narrow** — see the [scenario coverage](#scenario-coverage) table above. Outside the supported
  scenario, Luca says "we don't handle that yet" rather than guessing.

## Quick Start

The default setup uses Anthropic models (just for ease of startup), but Summa can run against **any OpenAI-compatible model server**. I've personally tested this using Ollama + Gemma4 on my MacBook Air M4. Semantic retrieval (RAG) over the IRS corpus runs **locally via Ollama** with EmbeddingGemma 2 — no API key, no cost.

| Variable | Required | What it does |
| --- | --- | --- |
| `LUCA_MODEL` | **Yes** | The conversation agent — must handle images (reads your W-2s). There is no in-code default: the app refuses to start without it. |
| `JUDGE_MODEL` | **Yes** | The grounding judges that double-check AI decisions. Also required at startup. |
| `ANTHROPIC_API_KEY` | With Anthropic models | Powers the two roles above when they point at Anthropic. |
| `LUCA_MODEL_URL` / `JUDGE_MODEL_URL` | For local models | Point a role at an OpenAI-compatible server instead, e.g. `LUCA_MODEL=ollama/gemma4:26b` + `LUCA_MODEL_URL=http://localhost:11434/v1`. |
| `EMBEDDINGS_MODEL` | No (defaults to `ollama/embeddinggemma-2`) | The local embedding model for semantic corpus search. Needs [Ollama](https://ollama.com) running with the model pulled; without it, search falls back to keyword matching. |
| `AGENT_API_TOKEN` | No | Gates the agent port if it's ever reachable beyond localhost. |

Local-model notes: vision, tool calling, and structured output all matter —
I've verified the full flow (document reading included) on `gemma4` via
Ollama. PDFs are rasterized to images automatically for models without
native PDF input. Expect turns to take minutes, not seconds, on laptop
hardware, and each model call must currently finish within 5 minutes.

You don't have to write this file from scratch: the first-run bootstrap
generates `apps/agent/.env.development` with the two model roles pre-filled
to Anthropic models (`anthropic/claude-sonnet-4-6` / `anthropic/claude-haiku-4-5`)
and working values for ports and `.data` paths. **The one thing it cannot
fill in is your `ANTHROPIC_API_KEY`** — set that yourself (or repoint the
model roles at a local server) before the app will do anything useful.

```bash
npm run install:all
npm run dev:all          # first run generates .env.development files
# → set ANTHROPIC_API_KEY in apps/agent/.env.development, restart
npm run corpus -- fetch  # prebuilt IRS reference corpus
ollama pull embeddinggemma-2          # local embedding model for RAG
```

The last step enables semantic (RAG) search over the IRS corpus and
requires [Ollama](https://ollama.com). It's optional: without it the
agent still works, and reference search falls back to keyword matching —
see [Semantic search](#semantic-search-rag-vs-keyword-fallback) below.

Open http://localhost:3000 — first run redirects to `/setup` to create your
owner account.

## Contributing

Because this project deals with tax calculations, I need to limit contributions until I can verify the person behind those contributions is real. Contributions will only be accepted in this repo by approved contributors. In order to get approved you need to contact the owner and maintainer of this repository. You can do that by filing a bug in this repo and suggesting who you are and why you want to contribute.

## Developer Guide

Congratulations on wanting to be a developer! The point of this project is that it should be collaborative. 

If you want to get setup locally to be able to add capabilities to this system there are a few things you need to know. I would really like the patterns that have been established to stay the same unless there is a significantly improved pattern that a core contributor wants to recommend. 

### Understanding The Agent

The current agent Luca is built off of the [Mastra](https://mastra.ai/docs) framework. If you want to watch the agent run, checkout the [mastra studio](http://localhost:4111) locally. We don't currently use all the features of the framework but there are two core concepts that we utilize:

* Agent Setup: Mastra allows us to have a really simple agent setup that uses either your local provided model or a cloud model. We have environment configurations for you to setup either of them. 
* Workflows: We have developed several workflows that help us reduce context and verify that what Luca is saying is actually based in facts. See the **apps/agent/src/mastra/workflows** to learn more about workflows

### Generating The Corpus

The agent and the workflows use a corpus of IRS provided guides to ground its information in truth and to generate the original bindings of the form engine. Here is how that corpus is turned into our data model that the agents can then search. We store information in both vector format and in plain text format for two reasons. First, so there is a backup option if you aren't running a local embedding model, and second because if you add plain text search queries it makes the model's retrieval capabilities better for corpus search. 

1. *Read* Using unpdf, we read the instructions files (ex: forms/federal/1040/instructions.pdf) from the IRS and turn them into text documents for further processing
2. *Parse (parse.ts)* turns those text documents into sections based on headers deterministically (No AI) with stable section IDs. 
3. *Contextualize (contextualize.ts)* receives each block and sends that to an LLM (haiku) that then adds contextual information as part of the block.
4. *Store* Then we store everything in the DB, as ref_documents (parent), ref_pages, ref_sections, and ref_blocks
5. *Embeddings* Next we convert each block's summary + text into RAG-capable embeddings with the local embedding model (EmbeddingGemma 2 via Ollama — see below). We store those vectors in each block's embedding column. 

### Semantic search (RAG) vs keyword fallback

Reference-corpus search runs two legs: a keyword leg (SQLite FTS5) and a semantic vector leg. **The vector leg requires a local embedding model served by Ollama** — there is no cloud embedding dependency (the earlier Voyage pipeline was removed). As a developer, to get full-quality RAG retrieval you need:

```bash
# one-time setup
ollama pull embeddinggemma-2          # 1.3 GB; needs Ollama ≥ 0.40
```

The prebuilt corpus (corpus-v2, via `npm run corpus -- fetch`) ships EmbeddingGemma 2 vectors, so no re-embedding is needed. If you have an older corpus-v1 db (Voyage-era vectors) or switch embedding models, run `npm run corpus -- reembed --all` (~4 min, free) — search detects the model mismatch and refuses to mix vector spaces until you do.

**If Ollama isn't running, nothing breaks** — searches log a warning and fall back to keyword (FTS) matching, which is a real but lower-recall mode: exact-term queries work well, paraphrased/semantic queries suffer. Fine for end users trying the app; not fine for judging retrieval quality or developing anything RAG-adjacent. Use `npm run corpus -- search "your query" --mode vector` (vs `--mode fts`) to see each leg's behavior, and `npm run corpus -- check` to confirm every block has an embedding.

The embedding model is configurable via `EMBEDDINGS_MODEL` / `EMBEDDINGS_MODEL_URL` (default `ollama/embeddinggemma-2` at `http://localhost:11434`). After changing models, always run `npm run corpus -- reembed --all` — vectors from different models are not comparable, and the corpus records which model built it (`ref_meta.embedding_model`) to enforce that.

### Scenario Creation

The core of this project is the scenarios that we test against, which validates that both our engine is correct and we can then use to validate the capabilities of different models against real CPA guidance. 

Right now, scenarios are broken down by "people" in the apps/agent/tests/scenarios folder. Each scenario has a set of input documents which are the expected documents we would need to be able to complete a tax analysis (ex: W2, 1099, etc...), as well as a brief description document. We have not yet implemented but intend to implement tests for how well the AI can process these documents through document ingestion workflows. 

Then for our engine integration tests, we generate a set of facts that reflect the decisions the AI engine would generate for a complete run of our form engine. Facts are things like "filing single" that would be questions the AI would normally ask in conversation flow. 

The simplest example we have of a scenario is *alex* who is a single filer california resident who makes <100k and does not have any other income other than a W2. 

*Every new field that we support in a document, or new document we support needs to have a scenario that uses it*

These scenarios are then run by a CPA in order to produce the *expected\*.ts* files (e.g. `expected.ts`, `expected-540.ts`) that verify the output. 

### Understanding The Form Engine

The form engine is what makes this project special, because it is the tool that the AI uses to understand what information it needs to gather to generate real tax documents. The form engine is really just an obtuse DAG (my wording) that resolves after several "runs" instead of trying to do the DAG computation every time. 

Each form field relies on either

1. A simple fact directly

example: 

``` 
/// state/ca/540/bindings.ts
"signing.taxpayer_email": (_, info) => info.taxpayerEmail,
```

2. An AI decision

```
      "header.filing_status_single": (_, info) => info.filingStatus === "single",
```

3. Some math

```
"line.14": (f) => sum(f["line.12e"], f["line.13a"], f["line.13b"]),
```

4. Dependent on a calculation in another form or table

```
"line.25c": (f) => {
  const m = f["form-8959.0.line.24_total_additional_medicare_tax_withholding"];
  return typeof m === "number" ? m : undefined;
},
```

Or some combination of all the above. If a line has not yet been developed it is explicitly marked in the form as *Unsupported*. 

Because there is a dependency tree involved, and I am not confident that the IRS docs system is a non-repeating DAG, we start by calculating the values we can in the form and then repeat that process. See *evaluateAllForms* for the code. 

## License

AGPL-3.0 — see [`LICENSE`](LICENSE).
