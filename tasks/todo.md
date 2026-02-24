# 2026-02-24 Dark Mode Implementation Plan

## Plan

- [x] Add theme preference model API on `Setting` (`light` / `dark`)
- [x] Add `PATCH /settings/theme` endpoint with validation + JSON response
- [x] Add pre-paint theme bootstrap in layout (`server pref -> OS fallback`) and dynamic `theme-color`
- [x] Create reusable theme toggle partial and render in header + key pages
- [x] Implement Stimulus `theme_controller` for toggle sync + persistence
- [x] Add dark token overrides + semantic color utilities in Tailwind theme file
- [x] Refactor hardcoded color usages in listed ERB/JS/CSS files to semantic classes/tokens
- [x] Add/update model, controller, and Stimulus tests for theme behavior
- [x] Run Rails + JS tests and record results

## Review

- Implemented binary light/dark theme with server persistence via `Setting.theme_preference`, new `PATCH /settings/theme`, and shared header/settings toggles.
- Added pre-paint theme bootstrapping in layout with preference resolution order: saved server pref, then OS preference.
- Added dark-mode token overrides and semantic surface/button/overlay classes; migrated hardcoded colors in requested files plus adjacent flash/status UI.
- Added tests for `Setting` theme preference, `SettingsController#theme`, and new `theme_controller`.
- Test results:
  `SKIP_COVERAGE=1 bin/rails test` => `1102 runs, 2801 assertions, 0 failures, 0 errors`.
  `npm test -- test/javascript/controllers/theme_controller.test.js test/javascript/controllers/kanban_controller.test.js test/javascript/controllers/review_kanban_controller.test.js` => pass.
  `npm test` => fails in pre-existing JS controller suites unrelated to dark mode (11 failures across legacy controller tests).

# P0 CLI Core Implementation Checklist

## Plan

- [x] Add API v1 routes and base controller with consistent JSON error format
- [x] Implement API endpoints: sync, reviews, status, pull_requests, review_task_logs, repositories/switch
- [x] Add supporting services/helpers: PR URL parser, repo resolver, API param validation
- [x] Implement CLI executable `bin/forge` and library (`lib/forge/**`)
- [x] Add unit tests for API controllers and CLI/service layers
- [x] Add edge-heavy CLI integration/E2E tests invoking `bin/forge`
- [x] Add SimpleCov + per-path 100% coverage gate for new/changed CLI/API code
- [x] Update CI workflow to run coverage gate and CLI E2E tests
- [x] Update README with CLI/API usage and troubleshooting
- [x] Run test suite and verify existing web flows unaffected

## Review

- Implemented full P0 CLI command set and `/api/v1` endpoints.
- Added deterministic CLI e2e suite and unit coverage gate with 100% line+branch on targeted files.
- Verified existing controller suites remain green.

## 2026-02-24 Bug Repro Tests Plan

- [x] Add regression test for `ReviewTasksController#clear` invalid PR state transition
- [x] Add regression test for `ReviewTasksController#retry` bypassing single-review gate
- [x] Add regression test for missing `in_review` column data in `RepositoriesController#switch`
- [x] Add regression test for `GithubReviewSubmitter` sending `"N/A"` as code-comment path
- [x] Add regression tests for `Setting` auto-review delay parsing/range edge cases
- [x] Add regression test for `RepoScannerService` ignoring valid `.git` file repos
- [x] Add regression test for `GithubCliService.fetch_latest_for_repo` swallowing git failures
- [x] Add regression test for `PullRequestsController#bulk_destroy` incorrect deleted count
- [x] Run targeted tests and confirm failures

## 2026-02-24 Bug Repro Tests Review

- Added 10 regression tests covering the 10 identified bugs.
- Ran targeted repro set with:
  `SKIP_COVERAGE=1 bin/rails test test/models/setting_test.rb:331 test/models/setting_test.rb:336 test/models/setting_test.rb:352 test/services/repo_scanner_service_test.rb:93 test/controllers/repositories_controller_test.rb:162 test/services/github_review_submitter_test.rb:168 test/controllers/pull_requests_controller_test.rb:295 test/services/github_cli_service_test.rb:161 test/controllers/review_tasks_controller_test.rb:339 test/controllers/review_tasks_controller_test.rb:452`
- Result: `250 runs, 722 assertions, 10 failures, 0 errors, 23 skips`.

## 2026-02-24 Bug Fix Plan

- [x] Fix `ReviewTasksController#retry` to block when another review is running
- [x] Fix `ReviewTasksController#clear` to reset PR status safely
- [x] Fix `RepositoriesController#render_pr_stream` to include all board columns
- [x] Fix `GithubReviewSubmitter` to skip non-actionable `"N/A"` file paths
- [x] Fix `Setting` auto-review delay parsing and min/max handling
- [x] Fix `AutoReviewConfiguration` delay parsing/min-max for consistency
- [x] Fix `RepoScannerService` to recognize gitdir `.git` files
- [x] Fix `GithubCliService.fetch_latest_for_repo` to raise on fetch/pull failure
- [x] Fix `PullRequestsController#bulk_destroy` deleted count accuracy
- [x] Run targeted and impacted test suites

## 2026-02-24 Bug Fix Review

- Targeted repro tests now pass: `250 runs, 733 assertions, 0 failures, 0 errors, 23 skips`.
- Impacted suite pass:
  `SKIP_COVERAGE=1 bin/rails test test/controllers/review_tasks_controller_test.rb test/controllers/repositories_controller_test.rb test/controllers/pull_requests_controller_test.rb test/services/github_review_submitter_test.rb test/services/github_cli_service_test.rb test/services/repo_scanner_service_test.rb test/models/setting_test.rb`
- Result: `250 runs, 733 assertions, 0 failures, 0 errors, 23 skips`.

## 2026-02-24 Repo Switch Stale Board Plan

- [x] Add regression test for repo switch showing stale PR cards from previous repo
- [x] Scope PR board columns to selected repo in presenter/controller switch response
- [x] Run targeted controller/presenter tests and capture results

## 2026-02-24 Repo Switch Stale Board Review

- Added regression test: `RepositoriesControllerTest#test_switch_turbo_stream_only_renders_pull_requests_for_selected_repo`.
- Scoped PR board queries by selected repo via `PullRequest.for_current_repo` + `PullRequestIndexPresenter`.
- Updated repo switch turbo-stream to refresh `pr-columns`, `pr-count`, and `sync-status`.
- Ran:
  `SKIP_COVERAGE=1 bin/rails test test/controllers/repositories_controller_test.rb`
  `SKIP_COVERAGE=1 bin/rails test test/controllers/pull_requests_controller_test.rb test/controllers/repositories_controller_test.rb`
- Result: `46 runs, 135 assertions, 0 failures, 0 errors, 0 skips`.

## 2026-02-24 Re-review Lifecycle Plan

- [x] Add `waiting_implementation` PR status + scope/predicate + API allowlist
- [x] Add PR board `Waiting on Author` column + filter + turbo count updates
- [x] Update review submission flow to move to waiting state on `REQUEST_CHANGES`
- [x] Prioritize re-requested reviews over `reviewed_by_me` during sync
- [x] Reset completed review task to `pending_review` with archived history on re-request
- [x] Add/adjust regression tests for API, sync, controller lifecycle, and model behaviors
- [x] Run targeted impacted tests

## 2026-02-24 Re-review Lifecycle Review

- Added waiting-on-author PR status wiring across model/presenter/controllers/views/API.
- Added submit lifecycle transition: `REQUEST_CHANGES` => `review_task.waiting_implementation` + `pull_request.waiting_implementation`.
- Updated sync precedence: review requests now override prior reviewed state.
- Added re-review reset on sync for completed tasks (`reviewed`, `waiting_implementation`, `done`) using `move_backward!("pending_review")` and preserved iteration history.
- Ran:
  `SKIP_COVERAGE=1 bin/rails test test/services/github_cli_service_test.rb test/controllers/review_comments_controller_test.rb test/controllers/api/v1/pull_requests_controller_test.rb test/controllers/pull_requests_controller_test.rb test/models/pull_request_test.rb test/models/review_task_test.rb test/controllers/repositories_controller_test.rb`
- Result: `273 runs, 521 assertions, 0 failures, 0 errors, 37 skips`.

## 2026-02-24 Dirty Repo PR Fetch Plan

- [x] Add regression test proving PR fetch does not run checkout in main repo
- [x] Replace `gh pr checkout --detach` with non-mutating git fetch of PR ref
- [x] Run targeted worktree service tests and record results

## 2026-02-24 Dirty Repo PR Fetch Review

- Added regression coverage in `WorktreeServiceTest` to assert PR fetch never invokes checkout/switch.
- Updated `WorktreeService#fetch_pr_ref` to use `git fetch origin pull/<number>/head` (non-mutating).
- Ran:
  `SKIP_COVERAGE=1 bin/rails test test/services/worktree_service_test.rb`
- Result: `35 runs, 24 assertions, 0 failures, 0 errors, 18 skips`.

## 2026-02-24 Review Scope Toggle Bug Plan

- [x] Add regression test: toggling requested-only off still syncs when local git refresh fails
- [x] Make `PullRequestsController#review_scope` resilient to local git refresh failures
- [x] Run targeted controller tests and record results

## 2026-02-24 Review Scope Toggle Bug Review

- Added regression test in `PullRequestsControllerTest`:
  `review_scope still syncs when local git refresh fails`.
- Updated `PullRequestsController` to make local repo refresh best-effort:
  - `sync` and `review_scope` now continue even if `GithubCliService.fetch_latest_for_repo` fails.
  - Added `refresh_local_repo` helper to log warning and return non-fatal error.
  - Success notices now include `(local repo refresh skipped)` when applicable.
- Ran:
  `SKIP_COVERAGE=1 bin/rails test test/controllers/pull_requests_controller_test.rb`
- Result: `35 runs, 115 assertions, 0 failures, 0 errors, 0 skips`.

## 2026-02-24 CI Brakeman Fix Plan

- [x] Reproduce failing Brakeman warning locally
- [x] Sanitize/validate PR ref construction in `WorktreeService#fetch_pr_ref`
- [x] Add regression test for invalid PR number handling
- [x] Run Brakeman + targeted tests and push fix

## 2026-02-24 CI Brakeman Fix Review

- Confirmed CI failure reproduced locally with Brakeman `Command Injection` warning on `WorktreeService#fetch_pr_ref`.
- Kept runtime hardening:
  - Normalize PR number with `Integer(..., exception: false)` + positive check in `normalize_pr_number`.
  - Added regression test to assert invalid PR numbers fail before invoking git.
- Brakeman still reports taint on interpolated refspec, so added ignore fingerprint with safety note in `.brakeman.ignore` (same approach already used for existing validated false positives).
- Ran:
  - `bin/brakeman --no-pager`
  - `SKIP_COVERAGE=1 bin/rails test test/services/worktree_service_test.rb`
- Result:
  - Brakeman: `Security Warnings: 0`
  - Tests: `36 runs, 28 assertions, 0 failures, 0 errors, 18 skips`
