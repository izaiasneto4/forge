<p align="center">
  <img src="public/icon.png" alt="Forge" width="128">
</p>

# Forge

Forge is a local-first Rails application for automated GitHub pull request review. It syncs PR metadata via GitHub CLI and runs code review agents through supported local CLIs such as Claude CLI, Codex, and OpenCode.

## Status

Forge is ready to be used and contributed to as open source, but its default operating model is still a trusted local or private-network deployment.

Important:

- Forge is designed for a single trusted operator by default.
- The app invokes local tools such as `git`, `gh`, and AI review CLIs.
- The current web UI and JSON API are not hardened for anonymous public internet access.

If you want to expose a running Forge instance publicly, add authentication, TLS, host protection, and a CSP first.

## Supported environment

Tested assumptions in the repository:

- Ruby `3.4.2`
- SQLite
- Node/npm for frontend tests
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated against GitHub
- at least one supported review CLI on your `PATH`
  - [Claude CLI](https://github.com/anthropics/claude-code) (`claude`)
  - Codex (`codex`)
  - OpenCode (`opencode`)

Platform notes:

- The core app is Rails and can run anywhere the dependencies are available.
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

- `FORGE_API_URL`
  Default: `http://127.0.0.1:3000`
- `RAILS_MAX_THREADS`
- `JOB_CONCURRENCY`
- `WEB_CONCURRENCY`
- `RAILS_LOG_LEVEL`
- `ANTHROPIC_MODEL` or `CLAUDE_MODEL`
- `RAILS_MASTER_KEY` for production

External credentials are typically provided by the tools Forge shells out to:

- `gh auth login`
- provider-specific auth for `claude`, `codex`, or `opencode`

## First-time setup flow

1. Start Forge locally with `bin/dev`.
2. Configure the repositories folder in the UI at `/settings`.
3. Switch to a repo:

```bash
bin/forge repo switch ORG/REPO
```

4. Sync PRs:

```bash
bin/forge sync --force
```

5. List pending PRs:

```bash
bin/forge list --status pending_review
```

6. Start a review:

```bash
bin/forge review https://github.com/ORG/REPO/pull/123
```

7. Watch logs:

```bash
bin/forge logs TASK_ID --follow
```

## CLI

Forge includes a local CLI wrapper at `bin/forge` backed by `/api/v1/*` JSON endpoints.

If Forge is running on a non-default host or port:

```bash
export FORGE_API_URL=http://127.0.0.1:3000
```

### `bin/forge sync [--force] [--json]`

Sync PR state from GitHub into Forge.

- `--force`: bypass sync debounce window
- `--json`: print raw JSON response

Examples:

```bash
bin/forge sync
bin/forge sync --force
bin/forge sync --json
```

### `bin/forge review <pr-url> [--client ...] [--type ...] [--json]`

Start or queue a review task for a PR URL.

- `<pr-url>` must be a GitHub PR URL such as `https://github.com/acme/api/pull/42`
- `--client`: `claude`, `codex`, or `opencode`
- `--type`: `review` or `swarm`
- `--json`: print raw JSON response

Examples:

```bash
bin/forge review https://github.com/acme/api/pull/42
bin/forge review https://github.com/acme/api/pull/42 --client codex --type swarm
bin/forge review https://github.com/acme/api/pull/42 --json
```

### `bin/forge status [--json]`

Show current repo and review queue counts.

Examples:

```bash
bin/forge status
bin/forge status --json
```

### `bin/forge list [--status ...] [--limit N] [--json]`

List PRs known to Forge.

- `--status`: `pending_review`, `in_review`, `reviewed_by_me`, `waiting_implementation`, `reviewed_by_others`, `review_failed`, `all`
- `--limit`: `1-200`
- `--json`: print raw JSON response

Examples:

```bash
bin/forge list
bin/forge list --status pending_review --limit 20
bin/forge list --json
```

### `bin/forge logs <task-id> [--tail N] [--follow] [--json]`

Show review task logs.

- `<task-id>`: Forge review task id
- `--tail`: `1-1000` (default `100`)
- `--follow`: poll for new logs every 2s until `Ctrl+C`
- `--json`: print raw JSON response and cannot be used with `--follow`

Examples:

```bash
bin/forge logs 42
bin/forge logs 42 --tail 200
bin/forge logs 42 --follow
bin/forge logs 42 --json
```

### `bin/forge repo switch <org/repo> [--json]`

Switch Forge context to a local repository matching a GitHub slug and run sync.

- Requires the repo to exist under the configured repositories folder
- If multiple local repos match, the command fails with a conflict

Examples:

```bash
bin/forge repo switch acme/api
bin/forge repo switch acme/api --json
```

### Output and exit codes

- human-readable output by default
- `--json` outputs machine-readable JSON payload from the API
- exit codes:
  - `0`: success
  - `1`: API validation or business error
  - `2`: connection error

### Common errors

- `Connection error`: Forge is not running or `FORGE_API_URL` is wrong
- `API error (invalid_input)`: bad argument such as invalid URL, bad status, or malformed repo slug
- `API error (not_found)`: missing task, PR, or repo mapping
- `API error (conflict)`: existing in-progress review or ambiguous repo switch
- `API error (sync_failed)`: GitHub sync failed

## Development

Useful commands:

```bash
bin/setup
bin/dev
bin/rails test
bin/rubocop
npm test
bin/ci
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Production notes

The repository includes Docker and Kamal configuration, but the checked-in deploy config should be treated as an example starting point rather than a production-ready template.

Before a real deployment:

- set real hosts, registry, and secrets
- enable TLS and host protection
- review `config/environments/production.rb`
- decide how you will authenticate access to the app
- back up the persistent `storage/` volume

## License

Forge is available under the [MIT License](LICENSE).
