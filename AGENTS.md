# Repository Guidelines

## Project Structure & Module Organization
Forge is a Rails 8 app with a service-oriented core.
- `app/` — Rails MVC plus `app/services/` for workflow orchestration and `app/presenters/` for view models.
- `frontend/` — React + Vite single-page app (dark, macOS-style design; styles in `frontend/src/styles/forge.css`). It builds into `public/frontend/`, which `FrontendController` serves.
- `app/assets/` and `public/` — static assets and icons.
- `config/` — environment, routes, and database configuration.
- `db/` — schema and migrations (SQLite).
- `test/` — Rails Minitest suite; frontend tests sit next to the code as `frontend/src/**/*.test.{ts,tsx}`.
- `bin/` and `script/` — developer and CI helpers.

## Build, Test, and Development Commands
- `bin/setup` — install dependencies and prepare the database.
- `bin/dev` — run the dev stack (Puma + Vite + Solid Queue).
- `bin/rails test` — run all Rails tests.
- `bin/rails test test/models/pull_request_test.rb` — run a single test file.
- `bin/rails test test/models/pull_request_test.rb:42` — run one test by line.
- `npm --prefix frontend test` / `npm --prefix frontend run test:watch` / `npm --prefix frontend run test:coverage` — Vitest suite for the frontend.
- `npm --prefix frontend run build` — type-check and rebuild `public/frontend/` (commit the output).
- `npx playwright test` — Playwright specs (expects server at `http://localhost:3000`).
- `bin/rubocop` — Ruby style checks (Rails Omakase).
- `bin/ci` — full CI flow (lint, security audits, tests).

## Coding Style & Naming Conventions
- Ruby follows `rubocop-rails-omakase`; run `bin/rubocop` before PRs.
- Indentation is 2 spaces (Ruby and JS).
- Ruby classes/modules are `CamelCase`; files and methods are `snake_case`.
- Service objects belong in `app/services/` and should be named after their responsibility (e.g., `SyncService`).

## Testing Guidelines
- Rails tests use Minitest with Mocha (`test/**/*_test.rb`).
- Frontend tests use Vitest + Testing Library (`frontend/src/**/*.test.{ts,tsx}`).
- Prefer focused unit tests; add integration coverage for PR sync/review flows.

## Commit & Pull Request Guidelines
- Commit subjects are short, imperative, and capitalized (e.g., “Add worktree service tests”).
- PRs should include: purpose, test commands run, and linked issues.
- Add screenshots or short clips for UI changes.

## Configuration Notes
This app requires authenticated CLI tools: `gh` (GitHub CLI) and `claude` (Claude CLI). Ensure both are on your `PATH` before running reviews or syncs.

## Review Queue Troubleshooting
- If a review stays in `pending_review` with no logs, first verify the jobs worker is running.
- Default dev flow: use `bin/dev` (it starts web + css + jobs via `Procfile.dev`).
- If running services manually, run `bin/jobs` in a separate terminal.
- Quick queue check:
  - `bin/rails runner 'puts({ready: SolidQueue::ReadyExecution.count, claimed: SolidQueue::ClaimedExecution.count, failed: SolidQueue::FailedExecution.count}.to_json)'`
  - If `ready > 0` and `claimed = 0`, worker is offline or not consuming.
- Quick task check:
  - `bin/rails runner 't=ReviewTask.find(<ID>); puts({state:t.state,started_at:t.started_at,worktree_path:t.worktree_path,logs:t.agent_logs.count}.to_json)'`
  - `pending_review` + `started_at=nil` + `logs=0` usually means job never started.
