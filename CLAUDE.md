# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Forge is a Rails 8 application for automated GitHub PR code reviews. It syncs PRs via GitHub CLI, runs AI-powered reviews using Claude CLI's `/code-review` skill, and tracks review state through a web interface.

## Commands

```bash
bin/setup          # Install deps, prepare DB
bin/dev            # Run dev server (Puma + Tailwind + Solid Queue)
bin/rails test     # Run all tests
bin/rails test path/to/test_file.rb              # Single file
bin/rails test path/to/test_file.rb:LINE_NUMBER  # Single test
bin/rubocop        # Lint (Rails Omakase style)
bin/ci             # Full CI: lint, security scans, tests
```

## Architecture

**Multi-database SQLite**: Primary (app data), queue (Solid Queue jobs), cache (Solid Cache), cable (Solid Cable WebSockets).

**Service layer** (`app/services/`):
- `CodeReviewService` - Orchestrates review workflow
- `GithubCliService` - Wraps `gh` CLI for PR operations
- `ClaudeReviewService` - Executes Claude CLI reviews
- `SyncService` - Syncs PRs from GitHub

**State machine**: ReviewTask progresses through `pending → in_review → reviewed → done`.

**Background jobs**: `ReviewTaskJob` processes reviews async via Solid Queue.

**Real-time**: Action Cable streams review progress to UI.

## Key Models

- `PullRequest` - Synced from GitHub, supports soft delete
- `ReviewTask` - Review job with state, retry logic, CLI client tracking
- `ReviewComment` - AI feedback stored per review
- `ReviewIteration` - Tracks multiple review passes
- `Setting` - App config (current repo, sync settings)

## External Dependencies

Requires CLI tools installed:
- `gh` (GitHub CLI) - for PR sync
- `claude` (Claude CLI) - for code reviews
