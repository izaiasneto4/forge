<p align="center">
  <img src="public/icon.png" alt="Ordem" width="128">
</p>

# Ordem

Ordem is a local-first application for automated GitHub pull request review: a Bun + Elysia API with a React frontend. It syncs PR metadata via GitHub CLI and runs code review agents through supported local CLIs such as Claude CLI, Codex, and OpenCode.

## Status

Ordem is ready to be used and contributed to as open source, but its default operating model is still a trusted local or private-network deployment.

Important:

- Ordem is designed for a single trusted operator by default.
- The app invokes local tools such as `git`, `gh`, and AI review CLIs.
- The current web UI and JSON API are not hardened for anonymous public internet access.

If you want to expose a running Ordem instance publicly, add authentication, TLS, host protection, and a CSP first.

## Supported environment

Tested assumptions in the repository:

- [Bun](https://bun.sh) `1.2.20` (runs the API, the job worker and the `ordem` CLI)
- SQLite (bundled with Bun)
- Node/npm for the frontend dev server, tests and builds
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated against GitHub
- at least one supported review CLI on your `PATH`
  - [Claude CLI](https://github.com/anthropics/claude-code) (`claude`)
  - Codex (`codex`)
  - OpenCode (`opencode`)

Platform notes:

- The core app runs anywhere Bun and the CLIs above are available.
- The folder picker UI uses `osascript`, so the interactive folder-picking flow is currently macOS-specific.
- On non-macOS systems, configure the repositories folder directly in settings or through persisted app state instead of relying on the picker dialog.

## Quick start

1. Install dependencies and prepare the database:

```bash
bin/setup
```

2. Start the development stack:

```bash
bin/dev
```

3. Visit [http://127.0.0.1:3000](http://127.0.0.1:3000).

4. Open `/settings` and set your repositories folder to a directory containing local Git repositories.

5. Ensure `gh` is authenticated and at least one supported review CLI is available on your `PATH`.

## Configuration

Runtime configuration is intentionally small. See [.env.example](.env.example) for the public template.

Common variables:

- `PORT`: API port. Default: `3000`
- `ORDEM_API_URL`: where the `ordem` CLI finds the API. Default: `http://127.0.0.1:3000`
- `DATABASE_PATH`: SQLite file. Default: `storage/development.sqlite3` (`storage/production.sqlite3` when `NODE_ENV=production`)
- `ORDEM_ALLOWED_HOSTS`: hosts allowed to reach the app. Default: localhost, `.localhost`, `.test` and IPs in development; any host in production
- `ORDEM_LOG_LEVEL`: `debug`, `info`, `warn` or `error`
- `ORDEM_DISABLE_JOB_WORKER=1`: queue background jobs without running them
- `ANTHROPIC_MODEL` or `CLAUDE_MODEL`

When upgrading an existing installation, use `bin/ordem` for CLI commands. The previous `FORGE_*` environment variables remain supported as fallbacks; `ORDEM_*` values take precedence. Keep your existing SQLite file at `DATABASE_PATH`. For Docker or Kamal, mount your existing storage volume at `/app/storage`; the Kamal example retains the existing volume identifier by default, while new installations may use `ordem_storage`. Existing review worktree directories and browser preferences also remain supported.

External credentials are typically provided by the tools Ordem shells out to:

- `gh auth login`
- provider-specific auth for `claude`, `codex`, or `opencode`

## First-time setup flow

1. Start Ordem locally with `bin/dev`.
2. Configure the repositories folder in the UI at `/settings`.
3. Switch to a repo:

```bash
bin/ordem repo switch ORG/REPO
```

4. Sync PRs:

```bash
bin/ordem sync --force
```

5. List pending PRs:

```bash
bin/ordem list --status pending_review
```

6. Start a review:

```bash
bin/ordem review https://github.com/ORG/REPO/pull/123
```

7. Watch logs:

```bash
bin/ordem logs TASK_ID --follow
```

## CLI

Ordem includes a local CLI wrapper at `bin/ordem` backed by `/api/v1/*` JSON endpoints.

If Ordem is running on a non-default host or port:

```bash
export ORDEM_API_URL=http://127.0.0.1:3000
```

### `bin/ordem sync [--force] [--json]`

Sync PR state from GitHub into Ordem.

- `--force`: bypass sync debounce window
- `--json`: print raw JSON response

Examples:

```bash
bin/ordem sync
bin/ordem sync --force
bin/ordem sync --json
```

### `bin/ordem review <pr-url> [--client ...] [--type ...] [--json]`

Start or queue a review task for a PR URL.

- `<pr-url>` must be a GitHub PR URL such as `https://github.com/acme/api/pull/42`
- `--client`: `claude`, `codex`, or `opencode`
- `--type`: `review` or `swarm`
- `--json`: print raw JSON response

Examples:

```bash
bin/ordem review https://github.com/acme/api/pull/42
bin/ordem review https://github.com/acme/api/pull/42 --client codex --type swarm
bin/ordem review https://github.com/acme/api/pull/42 --json
```

### `bin/ordem status [--json]`

Show current repo and review queue counts.

Examples:

```bash
bin/ordem status
bin/ordem status --json
```

### `bin/ordem list [--status ...] [--limit N] [--json]`

List PRs known to Ordem.

- `--status`: `pending_review`, `in_review`, `reviewed_by_me`, `waiting_implementation`, `reviewed_by_others`, `review_failed`, `all`
- `--limit`: `1-200`
- `--json`: print raw JSON response

Examples:

```bash
bin/ordem list
bin/ordem list --status pending_review --limit 20
bin/ordem list --json
```

### `bin/ordem logs <task-id> [--tail N] [--follow] [--json]`

Show review task logs.

- `<task-id>`: Ordem review task id
- `--tail`: `1-1000` (default `100`)
- `--follow`: poll for new logs every 2s until `Ctrl+C`
- `--json`: print raw JSON response and cannot be used with `--follow`

Examples:

```bash
bin/ordem logs 42
bin/ordem logs 42 --tail 200
bin/ordem logs 42 --follow
bin/ordem logs 42 --json
```

### `bin/ordem repo switch <org/repo> [--json]`

Switch Ordem context to a local repository matching a GitHub slug and run sync.

- Requires the repo to exist under the configured repositories folder
- If multiple local repos match, the command fails with a conflict

Examples:

```bash
bin/ordem repo switch acme/api
bin/ordem repo switch acme/api --json
```

### Output and exit codes

- human-readable output by default
- `--json` outputs machine-readable JSON payload from the API
- exit codes:
  - `0`: success
  - `1`: API validation or business error
  - `2`: connection error

### Common errors

- `Connection error`: Ordem is not running or `ORDEM_API_URL` is wrong
- `API error (invalid_input)`: bad argument such as invalid URL, bad status, or malformed repo slug
- `API error (not_found)`: missing task, PR, or repo mapping
- `API error (conflict)`: existing in-progress review or ambiguous repo switch
- `API error (sync_failed)`: GitHub sync failed

## Development

Useful commands:

```bash
bin/setup                      # install dependencies, prepare the database
bin/dev                        # API on :3000 plus the Vite dev server
bun run --cwd backend test     # API tests
bun run --cwd backend typecheck
npm --prefix frontend test     # frontend tests
```

The API lives in `backend/` (see [backend/README.md](backend/README.md)). Background jobs (reviews, syncs, AI summaries) run inside the API process. The database schema is managed by the migrations in `backend/drizzle/`, applied automatically on startup; an existing database created by the former Rails app is adopted in place.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Production notes

The repository includes Docker and Kamal configuration, but the checked-in deploy config should be treated as an example starting point rather than a production-ready template.

Before a real deployment:

- set real hosts, registry, and secrets
- enable TLS and set `ORDEM_ALLOWED_HOSTS`
- decide how you will authenticate access to the app
- back up the persistent `storage/` volume

## License

Ordem is available under the [MIT License](LICENSE).
