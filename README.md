# AI Project Hunter

An automated **opportunity discovery + qualification** agent for the **[Mostaql](https://mostaql.com)** freelance marketplace.

It periodically discovers newly-listed projects, retrieves their detail pages, evaluates each one against your freelance profile with an LLM, generates an Arabic proposal draft, and notifies you privately on **Telegram** — only for projects that clear your budget floor and score threshold. **It never submits proposals for you.**

## Table of contents

- [How it works](#how-it-works)
- [Features](#features)
- [Architecture](#architecture)
- [Project status & honest limitations](#project-status--honest-limitations)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Budget evaluation rules](#budget-evaluation-rules)
- [Scoring model](#scoring-model)
- [HTTP API](#http-api)
- [Deployment (Docker Compose / Coolify)](#deployment-docker-compose--coolify)
- [Security & safe scraping](#security--safe-scraping)
- [Troubleshooting](#troubleshooting)

## How it works

```
┌──────────────┐   scrape       ┌──────────────────┐   evaluate    ┌─────────────┐
│   Mostaql    │ ─────────────► │  Project Hunter   │ ────────────► │    OpenAI   │
│   listing    │  (polite,      │  (Fastify + Drizzle│  (JSON schema)│  (GPT-4o-mini)│
│   pages      │   gated)       │     + SQLite)     │               │             │
└──────────────┘                └─────────┬────────┘                └─────────────┘
                                          │ budget ≥ $100?          ▲
                                          │ score ≥ 75? ────────────┘
                                          ▼
                                ┌──────────────────────┐
                                │  Telegram notification│   Arabic proposal draft
                                │  + direct link        │   (stored, never sent)
                                └──────────────────────┘
```

1. **Discover** – On a schedule (default 30 min, or on demand via the admin API), scrape the Mostaql listing pages for project links. New and *changed* links are queued.
2. **Fetch detail** – Retrieve each project page (bounded concurrency, delays, retries). Detail pages for already-seen projects are only re-fetched when their listing fingerprint changes or the `SCRAPER_DETAIL_REFRESH_HOURS` window expires.
3. **Parse & normalize** – Extract title, description, skills, budget text, proposal count, and publication date. **No value is ever invented** – anything unobtainable is stored as `null`, and the page is marked as structurally changed so you get an alert.
4. **Budget gate** – Convert the budget to USD and classify it (see [rules](#budget-evaluation-rules)). Projects whose confirmed maximum is below `MIN_PROJECT_BUDGET_USD` are rejected before any LLM spend.
5. **Evaluate** – Score the project against your professional profile with the strict JSON schema. Projects below `MIN_PROJECT_SCORE` are rejected.
6. **Proposal draft** – Generate a tailored Arabic proposal (stored in the database + viewable via admin API). **Not auto-submitted**, ever.
7. **Notify** – Send a Telegram message with the project, score, budget and a direct link. Notifications are idempotent per project+content-version; failures are marked and retried on the next scan.

## Features

- **Budget-first filtering** – expensive projects are rejected before AI spend; "open"/unconvertible budgets are flagged `needs_review` instead of guessed at.
- **Strict, bounded AI spend** – `OPENAI_MAX_ANALYSES_PER_SCAN` caps projects per scan; score/JSON-schema validation rejects malformed model output.
- **Qualified statuses** – `discovered → needs_review/budget_rejected → pending_analysis → analyzed → qualified → notified`, with `rejected`, `notification_failed`, `manually_applied`, and `archived`.
- **Idempotent & resumable** – unique `(source, external_id)`; content-hash change detection triggers re-analysis; failed notifications retry next scan.
- **Resilient** – scan lock prevents overlap; expired locks are auto-recovered; transient HTTP/Telegram/OpenAI errors get bounded retries; `notification_failed` is recoverable by re-running a scan.
- **Safe by default** – disables itself after explicit blocking (HTTP 403/CAPTCHA/robots) and alerts you instead of hammering the site; polite robot UA; no auto-bidding.
- **Observable** – `/health`, `/ready`, `/stats`, prometheus-style counters, structured pino logs, scan log table with per-scan metrics.

## Architecture

- **Runtime** – Node.js 22 (ESM, TypeScript, path aliases via relative imports).
- **Web serving** – Fastify 5 (health, read-only stats, admin/internal routes guarded by `ADMIN_API_KEY`).
- **Storage** – SQLite via `better-sqlite3` + Drizzle ORM (WAL mode, migrations in `src/database/migrations/`).
- **Scraping** – Cheerio parsing; `HttpFetcher` with retries, backoff, concurrency limit, and explicit-block detection.
- **AI** – OpenAI SDK (`gpt-4o-mini` default) with strict Zod schemas for evaluation + proposal generation.
- **Notifications** – Telegram Bot API (HTML), long-message pagination, alerts with dedup window.
- **Scheduler** – `node-cron` with `noOverlap` + a DB-backed scan lock.

```
src/
├── config/        env (Zod) + Mostaql CSS selectors
├── database/      schema, client, migrations (Drizzle)
├── integrations/  http fetcher, openai, telegram
├── sources/       ProjectSource interface + Mostaql parsers
├── services/      repository, discovery, normalization, evaluation,
│                  proposal, notification, scan, health, system settings
├── jobs/          scheduler
├── container.ts   manual dependency injection (test-friendly)
├── app.ts         Fastify routes
└── index.ts       bootstrap / graceful shutdown
tests/             unit + integration suites (vitest)
```

## Project status & honest limitations

- **Code status:** Source implemented, typecheck passes, **78 tests green** (unit + integration). Build emits `dist/` with migrations.
- **Live end-to-end performance is NOT yet verified.** The scraper selectors in `src/config/selectors.ts` are best-effort guesses. Mostaql may use different markup, protections, or require login. **You must run a live scan (below) and check the `/stats` endpoint + Telegram alerts before trusting the pipeline.** If the listing/detail pages fail to parse, alert #`html_structure_mismatch` will fire — adjust `MOSTAQL_SELECTORS` accordingly.
- **JS-rendered pages** (if Mostaql requires them) are not supported out of the box; `PLAYWRIGHT_ENABLED` hooks exist but a browser is not bundled.
- **Proposals are drafts only.** Sending them is intentionally left to a human.

## Local development

Prerequisites: **Node.js ≥ 22** (npm ≤ 11 tested), and for `better-sqlite3` either its prebuilt binary for your Node ABI or local build tools.

```bash
corepack enable          # optional, enables pnpm-aware environments
npm ci
cp .env.example .env     # then fill in the 4 required values
```

Apply migrations and run:

```bash
npm run db:migrate       # or: npm run db:generate after schema edits
npm run dev              # node --import tsx, reads .env
```

Quality gates:

```bash
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (78 tests)
npm test -- --run tests/integration   # quicker subset
npm run build            # tsc emit + copy migrations to dist/
```

### Verifying live scraping

```bash
# 1. start the app, let one scheduled scan run (or trigger one):
curl -s -X POST http://127.0.0.1:3000/internal/scan \
     -H "x-api-key: $ADMIN_API_KEY"

# 2. inspect what was actually found/scored:
curl -s http://127.0.0.1:3000/internal/projects \
     -H "x-api-key: $ADMIN_API_KEY"
curl -s http://127.0.0.1:3000/stats
```

If the scraper gets blocked (403/CAPTCHA detected), it **stops itself** and sends an admin alert instead of continuing; unblock via `POST /internal/scraper/unblock` after you acknowledge the cause.

## Configuration

Runtime config comes from the environment (validated by Zod at startup — a missing required value fails fast with a clear message). See `.env.example` for the full annotated list.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | – | OpenAI key |
| `TELEGRAM_BOT_TOKEN` | ✅ | – | Telegram bot token |
| `TELEGRAM_CHAT_ID` | ✅ | – | Telegram chat to notify |
| `ADMIN_API_KEY` | ✅ | – | `x-api-key` for `/internal/*` routes |
| `SCAN_INTERVAL_MINUTES` | – | `30` | Schedule interval (min 1) |
| `SCAN_ON_STARTUP` | – | `false` | Run a scan at boot |
| `MIN_PROJECT_BUDGET_USD` | – | `100` | Budget floor |
| `MIN_PROJECT_SCORE` | – | `75` | Score threshold |
| `DATA_DIR` / `DATABASE_PATH` | – | `/app/data` / `<DATA_DIR>/project-hunter.sqlite` | SQLite location |
| `OPENAI_MODEL` | – | `gpt-4o-mini` | Model to use |
| `OPENAI_MAX_ANALYSES_PER_SCAN` | – | `10` | AI-spend cap per scan |
| `SCRAPER_MAX_LISTING_PAGES` | – | `1` | Listing pages to walk |
| `SCRAPER_DETAIL_REFRESH_HOURS` | – | `24` | Detail re-fetch window |
| `SCRAPER_ENABLED` | – | `true` | Master scrape switch |
| `MOSTAQL_SELECTORS` | – | *defaults* | JSON override of CSS selectors |
| `PLAYWRIGHT_ENABLED` | – | `false` | (requires browser install) |
| `BUDGET_USD_RATES` | – | *built-in map* | Currency→USD conversion rates |
| `ALERT_DEDUP_MINUTES` | – | `60` | Suppress duplicate admin alerts |

Running `npm run dev` / `npm start` reads `.env` automatically. Local example values:

```bash
OPENAI_API_KEY=sk-...
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=123456789
ADMIN_API_KEY=change-me-long-random-string
```

## Budget evaluation rules

`src/utils/money.ts` – budgets are parsed from free text into `{minUsd, maxUsd, convertible}`; nothing is assumed.

| Input | Classification |
|---|---|
| Confirmed max **below** `MIN_PROJECT_BUDGET_USD` | `budget_rejected` (no AI spend) |
| Range overlapping/exceeding the floor | `eligible` → analyzed |
| "Open"/negotiable/unknown budget | `needs_review` → analyzed, flagged |
| Transparent single amount | `min = max` (exact) |
| Foreign currency without a rate | `convertible: false` → `needs_review` (never treated as USD) |

## Scoring model

`src/services/evaluation.service.ts` – the model returns criteria each 0–30/0–20/0–13 and `overallScore` (0–100). We enforce the schema and, for defense in depth, recompute the total from the criteria and use the **lower** of model-vs-recomputed as the stored score, so a model can’t inflate its own grade.

| Criterion | Weight |
|---|---|
| Capability match | 30 |
| Financial viability | 20 |
| Requirements clarity | 13 |
| Delivery feasibility | 13 |
| Risk factor (low risk = higher score) | 9 |

## HTTP API

| Route | Auth | Description |
|---|---|---|
| `GET /health` | – | Database + basic liveness (`checks.database`) |
| `GET /ready` | – | `503` until migrations applied |
| `GET /stats` | – | Read-only counters (no PII/secrets) |
| `GET /internal/projects` | `x-api-key` | Paged project list |
| `GET /internal/projects/:id` | `x-api-key` | Detail + analyses + proposals + notifications |
| `PATCH /internal/projects/:id/status` | `x-api-key` | Transition status (`manually_applied`, `archived`, …) |
| `POST /internal/scan` | `x-api-key` | Trigger a scan now |
| `POST /internal/scraper/unblock` | `x-api-key` | Clear an explicit block |
| `GET /internal/scan-logs` | `x-api-key` | Recent scan reports |

## Deployment (Docker Compose / Coolify)

### Docker Compose

```bash
# validate the compose file (fails fast if required secrets are missing)
set -a; source .env; set +a
npm run compose:check

# build + run
npm run docker:build
docker compose up -d
```

The state (SQLite) lives on the named volume `project-hunter-data` → `/app/data`, so redeploys keep history. The container runs as a non-root user, has `restart: unless-stopped`, healthcheck, and bounded JSON logs. No port is published to the host by default; reverse proxies/Coolify attach to the internal `3000`.

### Coolify

1. Add **Project → Resource → Docker Compose**, point it at this repository.
2. Choose **Deploy** strategy: Dockerfile/Compose (build on the server).
3. Add the four required environment variables in the UI (`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ADMIN_API_KEY`) — these map to the `${VAR:?}` placeholders and will fail fast if missing.
4. (Optional) Attach a domain / proxy to expose `/health`; the admin API can stay internal.
5. Deploy. Watch `http://<host>:3000/health` (or the resource healthcheck) and the Telegram alerts for scraper issues.

> Persistence: Coolify re-creates containers on redeploy; the named volume keeps the SQLite data intact.

## Security & safe scraping

- **No secrets in code or logs.** Secrets come only from the environment; `process.env` is never dumped; health/stats endpoints return no sensitive values (tests assert this).
- **No auto-submission.** Proposal generation is a draft, stored and viewable; delivery to Mostaql is deliberately never wired up.
  - Exception-free design: `manually_applied` status exists for when you do apply manually.
- **Polite scraping.** Delays between requests, bounded concurrency, retries with backoff, `robots.txt` consulted, and an **explicit-block shutdown** (403/CAPTCHA/robots denied) with an admin alert. Don’t raise `SCRAPER_MAX_CONCURRENCY` without justification.
- **SQLite hardening.** WAL mode, `busy_timeout`, foreign keys, prepared statements via Drizzle.
- **Admin API auth.** All `/internal/*` routes require the `ADMIN_API_KEY` header with constant-time comparison.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| App exits with `Invalid environment configuration` | Missing required env var; add it and restart. |
| Telegram alert "تم إيقاف جمع البيانات" (`scraper_blocked`) | Mostaql returned 403/CAPTCHA. Verify in a browser, then `POST /internal/scraper/unblock`. Inspect with `POST /internal/scan` after fixing the cause. |
| Alert "فشل تحليل بنية صفحة المشاريع" | Selectors match nothing. Inspect live HTML and adjust `MOSTAQL_SELECTORS`. |
| No projects ever notified | Check `/internal/projects` statuses; verify budget/scoring thresholds and that OpenAI key + Telegram chat are correct. |
| `technical` alerts to Telegram contain no project links | Those are admin alerts by design (dedup window suppresses repeats). |
| `better-sqlite3` fails to install | Use Node ≥ 22 (prebuilds) or install `build-essential python3 make g++` before `npm ci`. |

## License

Private/proprietary; not for redistribution.