# Forge Roadmap

## Priority Features

### P0 - CLI

Core CLI commands for terminal workflow:

| Command | Description |
|---------|-------------|
| `forge sync` | Manual PR sync from GitHub |
| `forge review <pr-url>` | Trigger review from terminal |
| `forge status` | Quick queue/task status check |
| `forge list` | List pending PRs |
| `forge logs <task-id>` | View review logs |
| `forge repo switch <org/repo>` | Switch repos |

Implementation: Thin CLI wrapper (Thor/GLI) that talks to Rails app via REST API.

---

### P1 - In-app Diff Viewer

Browse PR files and add comments directly in Forge UI instead of opening GitHub.

- File tree navigation
- Syntax highlighted diffs
- Inline commenting on specific lines
- Submit comments back to GitHub

---

### P1 - Review Scheduling

Automated sync/review on a schedule:

- Cron-style scheduling (e.g., "every morning at 9am")
- Configurable per-repo schedules
- Background jobs via SolidQueue

---

### P2 - Custom Review Prompts

Templates for different PR types:

- Bugfix template
- Feature template  
- Refactor template
- Security-focused template

User can select template when starting review.

---

### P2 - Auto-merge

Auto-merge after review approval:

- Monitor for CI passing
- Auto-approve and merge when checks green
- Configurable: require human approval first

---

## Phase Breakdown

**Phase 1**: CLI core + multi-repo switch (already works)
**Phase 2**: Diff viewer + scheduling
**Phase 3**: Prompts + auto-merge