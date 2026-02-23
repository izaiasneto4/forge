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

Forge includes a local CLI wrapper (`bin/forge`) backed by JSON API endpoints.

```bash
# Sync PR data
bin/forge sync --force

# Trigger review
bin/forge review https://github.com/org/repo/pull/123 --client codex --type review

# Status / list / logs
bin/forge status
bin/forge list --status pending_review --limit 20
bin/forge logs 42 --tail 100

# Switch repository by slug
bin/forge repo switch org/repo
```

Defaults:
- `FORGE_API_URL=http://127.0.0.1:3000`
- `--json` available on all commands
