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
