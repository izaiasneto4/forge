# Ordem Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the app-owned Forge identity to Ordem consistently across the repository.

**Architecture:** Keep the Rails app structure and change its names in place. Rename the CLI and Ruby namespace with their paths, update app-owned runtime/configuration labels, then update UI/docs and rebuild the checked-in frontend assets.

**Tech Stack:** Rails 8, Ruby, React/Vite, npm, Kamal, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-07-ordem-rename-design.md`

## Global Constraints

- This is a complete in-repository rename. Existing scripts that call `bin/forge`, Ruby consumers that reference `Forge::*`, and environments that set `FORGE_API_URL` must move to the Ordem names. No compatibility wrappers or deprecated aliases will be retained.
- The new worktree directory and branch prefix apply to newly created review worktrees. Existing per-repository `.forge-worktrees` directories and historical branches are not migrated or deleted by this change.
- The persistent Kamal volume remains named `forge_storage` to retain the current data identity.
- Generic English uses such as “request forgery” are unrelated and remain unchanged. Git history, `.git` metadata, and the current workspace directory are outside the rename.
- Preserve unrelated existing working-tree changes. Do not add or run tests as part of this task.

## File Map

- CLI and Rails identity: `config/application.rb`, `bin/forge`, `lib/forge/`, `test/lib/forge/`, and the CLI integration test.
- Runtime and deployment identity: app services that generate worktree, temporary-file, sync, triage, or review attribution identifiers; `config/deploy.yml`; `Dockerfile`; `lib/tasks/`.
- UI and project guidance: API UI payload, `frontend/`, README, security/project docs, issue templates, feature/roadmap files, and generated `public/frontend/` output.
- Rename-dependent references: existing CLI, worktree, attribution, and frontend surface tests; CI and coverage helper paths.

## Review Focus

- A stale CLI path, namespace, CI command, or helper glob can break command startup; audit all references after the moves.
- `FORGE_API_URL` must not remain as a hidden fallback; confirm only `ORDEM_API_URL` is read or documented.
- App-specific worktree names must change without altering generic “request forgery” language; search exact app identifiers and inspect matches.
- The frontend source and generated `public/frontend/` assets must show the same Ordem title and header.
- Existing uncommitted work in overlapping files must remain intact; inspect the final diff against the initial working-tree state.

---

### Task 1: Rename the CLI and Rails namespace

**Files:**
- Rename: `bin/forge` to `bin/ordem`
- Rename: `lib/forge/` to `lib/ordem/`
- Rename: `test/lib/forge/` to `test/lib/ordem/`
- Rename: `test/integration/forge_cli_e2e_test.rb` to `test/integration/ordem_cli_e2e_test.rb`
- Modify: `config/application.rb`, `test/test_helper.rb`, `.github/workflows/ci.yml`, `script/check_cli_api_coverage`
- Modify: `README.md`, `package.json`, `package-lock.json`, and existing CLI tests

- [ ] Move the CLI/library/test paths and change their `require` paths and Ruby constants from `Forge` to `Ordem`.
- [ ] Change CLI usage and package instructions to `ordem`; read `ORDEM_API_URL` and remove reads of `FORGE_API_URL`.
- [ ] Update existing CLI tests, integration setup, CI test path, coverage helper path, and test-helper glob to the Ordem paths/names.
- [ ] Update the root npm package name and its lockfile root package names to `ordem`.
- [ ] Audit CLI-owned references with `rtk rg -n -i 'forge|ordem'` over the changed paths; ensure executable, namespace, environment, and helper paths use Ordem.

### Task 2: Rename app-owned runtime and deployment identifiers

**Files:**
- Modify: `app/services/worktree_service.rb`, `app/services/code_review_service.rb`, `app/services/pull_request_summary_service.rb`, `app/services/sync_mode.rb`, `app/services/github_review_submitter.rb`, `app/services/file_triage_service.rb`, `app/services/jev_client.rb`
- Modify: `lib/tasks/review_lifecycle_backfill.rake`, `config/deploy.yml`, `Dockerfile`
- Modify: `test/services/worktree_service_test.rb`, `test/services/github_review_submitter_test.rb`, `test/services/file_triage_service_test.rb`, `test/services/jev_client_test.rb`

- [ ] Change new worktree paths/branches, code-review marker, summary temp-file prefix, sync key, triage session/user, review attribution, and app metadata to Ordem names.
- [ ] Set the source-level referer to `https://github.com/izaiasneto4/ordem` and update the visible triage title.
- [ ] Change Kamal service/image labels and Docker examples to `ordem`; retain the volume identifier `forge_storage`.
- [ ] Update existing expected paths, branch names, and attribution assertions to match the new runtime names.
- [ ] Audit these files for remaining app-specific Forge identifiers; retain only the specified storage identifier and unrelated generic wording.

### Task 3: Rename UI, docs, and generated frontend output

**Files:**
- Modify: `app/presenters/api/v1/ui_payloads.rb`, `frontend/src/App.tsx`, `frontend/index.html`, `frontend/src/styles/app.css`
- Modify: `README.md`, `SECURITY.md`, `AGENTS.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`
- Modify: `features.json`, `tasks/roadmap.md`, `tasks/todo.md`, `test/controllers/api/v1/frontend_surface_test.rb`
- Regenerate: `public/frontend/index.html` and `public/frontend/assets/`

- [ ] Change app-facing UI and metadata names to Ordem, including the Rails UI payload and existing frontend surface assertion.
- [ ] Update repository-maintained descriptions, commands, and roadmap references while leaving generic “request forgery” text unchanged.
- [ ] Run `rtk npm run frontend:build` to regenerate the checked-in frontend output from the updated source.
- [ ] Run `rtk git diff --check`.
- [ ] Search repository files outside `.git`, dependency/build caches, and ignored files for `forge`; inspect remaining matches and confirm they are only the documented storage identifier or generic language.
- [ ] Review `rtk git status --short` and the full diff to ensure earlier uncommitted changes are preserved.
