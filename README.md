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
