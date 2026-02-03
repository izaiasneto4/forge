# Repository Guidelines

## Project Structure & Module Organization
Forge is a Rails 8 app with a service-oriented core.
- `app/` — Rails MVC plus `app/services/` for workflow orchestration and `app/presenters/` for view models.
- `app/javascript/` — Stimulus/Turbo front-end code; controllers live in `app/javascript/controllers/`.
- `app/assets/` and `public/` — static assets and icons.
- `config/` — environment, routes, and database configuration.
- `db/` — schema and migrations (SQLite).
- `test/` — Rails Minitest suite; JS tests live in `test/javascript/`.
- `bin/` and `script/` — developer and CI helpers.

## Build, Test, and Development Commands
- `bin/setup` — install dependencies and prepare the database.
- `bin/dev` — run the dev stack (Puma + Tailwind + Solid Queue).
- `bin/rails test` — run all Rails tests.
- `bin/rails test test/models/pull_request_test.rb` — run a single test file.
- `bin/rails test test/models/pull_request_test.rb:42` — run one test by line.
- `npm test` / `npm run test:watch` / `npm run test:coverage` — Vitest suite for JS.
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
- JS tests use Vitest (`test/javascript/**/*.{test,spec}.{js,ts,jsx,tsx}`).
- Prefer focused unit tests; add integration coverage for PR sync/review flows.

## Commit & Pull Request Guidelines
- Commit subjects are short, imperative, and capitalized (e.g., “Add worktree service tests”).
- PRs should include: purpose, test commands run, and linked issues.
- Add screenshots or short clips for UI changes.

## Configuration Notes
This app requires authenticated CLI tools: `gh` (GitHub CLI) and `claude` (Claude CLI). Ensure both are on your `PATH` before running reviews or syncs.
