# Repository Guidelines

## Project Structure & Module Organization
Forge is a Bun + Elysia API with a React frontend.
- `backend/src/` — the API: `routes/` (HTTP endpoints under `/api/v1`), `presenters/` and `contracts/` (JSON payloads and their TypeBox schemas), `services/` (GitHub sync, AI review runs, submissions), `models/` (Drizzle data access and domain rules), `jobs/` (persistent job queue and handlers), `realtime/` (plain WebSocket server at `/ws`).
- `backend/drizzle/` — SQL migrations; `backend/src/db/schema.ts` is the Drizzle schema.
- `backend/test/` — Bun tests; `backend/test/support/` has the in-memory test context and factories.
- `backend/bin/` — `forge` CLI and `migrate` entrypoints.
- `frontend/` — React + Vite app; its production build is served from `public/frontend`.
- `public/` — static assets and error pages served by the API.
- `storage/` — SQLite databases.
- `bin/` — developer helpers (`setup`, `dev`, `forge`).

## Build, Test, and Development Commands
- `bin/setup` — install dependencies and prepare the database.
- `bin/dev` — run the API (port 3000, with its in-process job worker) and the Vite dev server.
- `bun run --cwd backend test` — run all API tests.
- `bun test backend/test/models/pull-request.test.ts` — run a single test file.
- `bun run --cwd backend typecheck` — strict TypeScript check.
- `npm --prefix frontend test` / `npm --prefix frontend run build` — frontend tests and build.

## Coding Style & Naming Conventions
- TypeScript is strict: no `any`, no type assertions (`as`, including `as const`), no non-null `!`. Narrow `unknown` with type guards or TypeBox. For literal constants use `literals(...)` (`backend/src/lib/literals.ts`) or `Object.freeze({...})`.
- 2-space indentation, single quotes, no semicolons.
- Files are `kebab-case.ts`; functions and variables `camelCase`; types and classes `PascalCase`. JSON payloads keep the API's `snake_case` keys.
- Services take the `AppContext` (`{ db, events, jobs, commands }`) explicitly; subprocesses go through `ctx.commands.run`, never `Bun.spawn` directly.

## Testing Guidelines
- Tests use `bun:test` with `createTestContext()` (in-memory SQLite, recording broadcaster, fake command runner).
- Declare inputs as named variables and assert against them; no network and no real `gh`/AI CLIs in tests.
- Route tests go through the real app (`createTestApp`) so contracts and error envelopes are exercised.

## Commit & Pull Request Guidelines
- Commit subjects are short, imperative, and capitalized (e.g., “Add worktree service tests”).
- PRs should include: purpose, test commands run, and linked issues.
- Add screenshots or short clips for UI changes.

## Configuration Notes
This app requires authenticated CLI tools: `gh` (GitHub CLI) and an AI review CLI (`claude`, `codex` or `opencode`). Ensure they are on your `PATH` before running reviews or syncs.

## Review Queue Troubleshooting
- Jobs run inside the API process; a review stuck in `pending_review` with no logs usually means the server was started with `FORGE_DISABLE_JOB_WORKER=1` or crashed mid-run.
- Quick queue check:
  - `bun -e 'import {Database} from "bun:sqlite"; console.log(new Database("storage/development.sqlite3").query("select name, state, count(*) n from jobs group by 1,2").all())'`
  - Jobs stuck in `ready` with none `claimed` means the worker is not running.
- Quick task check: `bin/forge logs <TASK_ID>` or `GET /api/v1/review_tasks/<ID>/logs`.
- Tasks left `in_review` by a crash are recovered automatically (on page loads and every 5 minutes).

## Cursor Cloud specific instructions

- `bin/setup` installs dependencies and migrates the database, then replaces itself with `bin/dev` unless you pass `--skip-server`.
- `bin/dev` starts the Bun API at `http://127.0.0.1:3000` (job worker in-process) and Vite at `http://127.0.0.1:5173/frontend/`. Vite proxies `/api` and `/ws` to `FORGE_API_URL` or `http://localhost:3000`. When `public/frontend/index.html` exists, the API serves that build; otherwise development requests redirect to Vite.
- The folder picker uses macOS `osascript`. On Linux, set Repos Folder in Settings to an existing directory. Forge lists immediate child directories that contain a `.git` entry.
- `gh` is on `PATH`. Cloud Agent integration tokens can read this repository's pull requests, but `gh api user` returns HTTP 403, so switching a repository and syncing fails until a user-scoped GitHub credential is available. `claude`, `codex`, and `opencode` are not required to boot the app or run the test suite.
