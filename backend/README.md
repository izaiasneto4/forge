# Ordem API (Bun + Elysia)

The whole server side of Ordem: the `/api/v1` JSON API, the ActionCable-compatible
WebSocket at `/cable`, the background job worker, and static serving of the built
frontend. It replaced the original Rails app with the same contract, so the React app
and the `ordem` CLI work unchanged.

```sh
bun install
bun run dev        # http://localhost:3000 (API + job worker + frontend build)
bun test
bun run typecheck
bun bin/migrate.ts # create or upgrade the database without starting the server
bun bin/ordem.ts   # the ordem CLI (see the root README)
```

| Env | Default |
|---|---|
| `PORT` | `3000` |
| `ORDEM_ROOT` | repo root; the server runs from here so relative repo paths resolve as before |
| `DATABASE_PATH` | `storage/development.sqlite3` (`storage/production.sqlite3` in production), relative to `ORDEM_ROOT` |
| `ORDEM_ALLOWED_HOSTS` | development: localhost, `.localhost`, `.test`, IPs; production: any host |
| `FRONTEND_DEV_URL` | `http://localhost:5173` (used when no frontend build exists) |
| `ORDEM_LOG_LEVEL` | `info` (`silent` under `bun test`) |
| `ORDEM_DISABLE_JOB_WORKER` | unset; `1` queues jobs without running them |

## Layout

- `src/routes/` — endpoints; `src/contracts/` — TypeBox response schemas.
- `src/presenters/` — JSON payloads and markdown rendering.
- `src/models/` — Drizzle data access with the domain rules (validations, state
  transitions, after-commit broadcasts).
- `src/services/` — GitHub sync (`sync/`), AI review runs, submissions, summaries.
- `src/jobs/` — SQLite-backed job queue, in-process worker, recurring maintenance.
- `src/realtime/` — WebSocket server speaking the `actioncable-v1-json` protocol.
- `src/cli/` — the `ordem` CLI.

## Contract rules

- Same paths, snake_case keys, and `{ ...payload, ok: true }` / `{ ok: false, error: { code, message, details? } }` envelope as the original API.
- GET routes declare `response` schemas; a payload that breaks its schema returns a 500 instead of reaching the client.

## Database

Migrations live in `drizzle/` and run on startup. `0000_rails_baseline.sql` is the
schema the Rails app left behind: a database created by Rails is adopted in place
(the baseline is recorded as applied and only newer migrations run). Add new
migrations as numbered SQL files with a matching entry in `drizzle/meta/_journal.json`.
