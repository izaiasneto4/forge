<p align="center">
  <img src="public/icon.png" alt="Forge" width="128">
</p>

# Forge

A Rails application for automated GitHub PR code reviews. Syncs pull requests via GitHub CLI and runs AI-powered reviews using Claude CLI.

## Requirements

- Ruby 3.4.2
- SQLite
- [GitHub CLI](https://cli.github.com/) (`gh`) - authenticated
- [Claude CLI](https://github.com/anthropics/claude-code) (`claude`)

## Installation

```bash
bin/setup   # Install dependencies and prepare database
bin/dev     # Start development server
```

Visit `http://localhost:3000`

## CLI

Forge includes a local CLI wrapper (`bin/forge`) backed by `/api/v1/*` JSON endpoints.

### Quick Start

1. Start Forge server:
```bash
bin/dev
```

2. In another terminal, verify CLI can talk to Forge:
```bash
bin/forge status
```

3. If Forge is running on non-default host/port, set:
```bash
export FORGE_API_URL=http://127.0.0.1:3000
```

Default is `http://127.0.0.1:3000`.

### First-Time Setup Flow

1. Ensure `Setting.repos_folder` is configured in Forge UI (`/settings`) to a folder containing local git repos.
2. Switch to a repo:
```bash
bin/forge repo switch ORG/REPO
```
3. Sync PRs:
```bash
bin/forge sync --force
```
4. List pending PRs:
```bash
bin/forge list --status pending_review
```
5. Start review for a PR:
```bash
bin/forge review https://github.com/ORG/REPO/pull/123
```
6. Watch logs:
```bash
bin/forge logs TASK_ID --follow
```

### Command Reference

#### `bin/forge sync [--force] [--json]`
Sync PR state from GitHub into Forge.

- `--force`: bypass sync debounce window.
- `--json`: print raw JSON response.

Examples:
```bash
bin/forge sync
bin/forge sync --force
bin/forge sync --json
```

#### `bin/forge review <pr-url> [--client ...] [--type ...] [--json]`
Start or queue a review task for a PR URL.

- `<pr-url>` must be a GitHub PR URL, e.g. `https://github.com/acme/api/pull/42`.
- `--client`: `claude`, `codex`, or `opencode`.
- `--type`: `review` or `swarm`.
- `--json`: print raw JSON response.

Examples:
```bash
bin/forge review https://github.com/acme/api/pull/42
bin/forge review https://github.com/acme/api/pull/42 --client codex --type swarm
bin/forge review https://github.com/acme/api/pull/42 --json
```

#### `bin/forge status [--json]`
Show current repo and review queue counts (`pending`, `in_review`, `queued`, `failed`).

Examples:
```bash
bin/forge status
bin/forge status --json
```

#### `bin/forge list [--status ...] [--limit N] [--json]`
List PRs known to Forge.

- `--status`: `pending_review`, `in_review`, `reviewed_by_me`, `reviewed_by_others`, `review_failed`, `all`.
- `--limit`: 1-200.
- `--json`: print raw JSON response.

Examples:
```bash
bin/forge list
bin/forge list --status pending_review --limit 20
bin/forge list --json
```

#### `bin/forge logs <task-id> [--tail N] [--follow] [--json]`
Show review task logs.

- `<task-id>`: Forge review task id.
- `--tail`: 1-1000 (default 100).
- `--follow`: poll for new logs every 2s until Ctrl+C.
- `--json`: print raw JSON response (cannot be used with `--follow`).

Examples:
```bash
bin/forge logs 42
bin/forge logs 42 --tail 200
bin/forge logs 42 --follow
bin/forge logs 42 --json
```

#### `bin/forge repo switch <org/repo> [--json]`
Switch Forge context to a local repository matching GitHub slug and run sync.

- Requires repo to exist under configured repos folder.
- If multiple local repos match, command fails with conflict.

Examples:
```bash
bin/forge repo switch acme/api
bin/forge repo switch acme/api --json
```

### Output and Exit Codes

- Human-readable output by default.
- `--json` outputs machine-readable JSON payload from API.
- Exit codes:
  - `0`: success
  - `1`: API validation/business error
  - `2`: connection error (Forge not reachable)

### Common Errors

- `Connection error`: Forge app is not running or `FORGE_API_URL` is wrong.
- `API error (invalid_input)`: bad argument (invalid URL, bad status/limit, malformed repo slug).
- `API error (not_found)`: missing task, PR, or repo mapping.
- `API error (conflict)`: existing in-progress review or ambiguous repo switch.
- `API error (sync_failed)`: GitHub sync failed.

### Automation / CI Usage

Prefer `--json` for scripts:

```bash
bin/forge status --json
bin/forge list --status pending_review --limit 50 --json
bin/forge review https://github.com/acme/api/pull/42 --json
```
