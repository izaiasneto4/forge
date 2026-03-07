# 2026-03-06 React/Vite Frontend + API-Only Rails

## Plan

- [ ] Replace Rails HTML/Turbo UI contract with JSON + ActionCable event contracts for pull requests, review tasks, repositories, settings, and review submissions
- [ ] Add frontend-facing serializers/presenters so Rails exposes stable page/domain payloads instead of view partials
- [ ] Build standalone `frontend/` Vite + React + TypeScript app with route parity for `/`, `/review_tasks`, `/review_tasks/:id`, `/repositories`, and `/settings`
- [ ] Port current visual system into frontend Tailwind/CSS and recreate the main interactive flows without Turbo/Stimulus
- [ ] Rewire dev/build scripts so Vite proxies `/api` and `/cable` in dev and the built frontend can be served statically in production
- [ ] Remove importmap/Stimulus/Turbo/tailwindcss-rails app UI runtime and delete obsolete Rails UI views/controllers/assets
- [ ] Run targeted Rails tests, frontend tests, and production build checks; record results and remaining gaps

## Notes

- Existing UI behavior is concentrated in five screens: pull request board, review task board, review task detail, repositories, settings.
- Existing real-time behavior is split between Turbo stream board updates and ActionCable JSON payloads for notifications/logs.
- Current `api/v1` covers CLI flows only; it is not yet complete enough for the browser UI.

## Review

- Added browser-facing Rails API endpoints for bootstrap, pull request board/actions, review task board/detail/actions, review submissions, repositories, and settings.
- Added typed JSON websocket broadcasts via `UiEventBroadcaster` and `UiEventsChannel`; retained ActionCable notifications/log streams.
- Built a standalone `frontend/` Vite + React + TypeScript app that serves the main routes and compiles into `public/frontend`.
- Switched the public Rails UI surface to SPA/static entrypoints plus `/api`, `/cable`, and `/up`.
- Removed the old Turbo/Stimulus/importmap/tailwindcss-rails runtime, deleted the legacy Rails UI views/controllers, and moved Node UI tooling ownership to `frontend/`.
- Added frontend Vitest coverage for the API client smoke path and Rails request smoke coverage for the new frontend API surface.

### Verification

- `npm --prefix frontend run test`
- `npm --prefix frontend run build`
- `SKIP_COVERAGE=1 asdf exec bundle exec rails test test/controllers/api/v1/frontend_surface_test.rb test/controllers/api/v1/pull_requests_controller_test.rb test/controllers/api/v1/repositories_controller_test.rb test/controllers/api/v1/review_task_logs_controller_test.rb test/controllers/api/v1/status_controller_test.rb test/controllers/api/v1/syncs_controller_test.rb test/services/pull_request_broadcaster_test.rb test/services/review_task_broadcaster_test.rb`
- `asdf exec bundle exec rails routes | rg "/cable|frontend#index|api/v1/bootstrap|api/v1/pull_requests/board|api/v1/review_tasks/board|api/v1/settings|api/v1/repositories|api/v1/review_tasks/:id/submissions"`

# 2026-02-24 Review Comment UX + Suggested Fix Guardrails Plan

## 2026-03-04 Unit Coverage Plan

### Plan

- [x] Audit current Ruby and JS unit-test coverage with fresh reports, not the stale checked-in `coverage/` artifact
- [ ] Expand Ruby SimpleCov tracking from the current API/CLI subset to all unit-testable app/lib code
- [ ] Exclude non-unit targets from the 100% gate explicitly (`views`, generated framework glue, integration/system paths) so the goal is honest
- [ ] Remove skipped-test debt by replacing fragile stubs with Mocha expectations or test doubles
- [ ] Fix test-environment data/setup issues causing foreign-key skips
- [ ] Separate unit and non-unit suites in CI so coverage is enforced only on unit suites
- [ ] Add a JS coverage gate for `app/javascript/controllers/**` at 100% line/branch/function if feasible, otherwise document exact exceptions
- [ ] Fill uncovered branches file-by-file, starting with the currently gated Ruby files, then models/services/jobs/controllers/helpers/presenters/validators/lib
- [ ] Add or tighten scripts so local + CI runs fail on coverage regression
- [ ] Run full unit suites with coverage enabled and record final percentages and remaining exceptions

### Notes

- Current Ruby gate is intentionally narrow: `test/test_helper.rb` tracks only API controllers, a few services, and `lib/forge/**`.
- Current JS setup can generate coverage, but CI does not enforce it.
- There are currently many explicit skips in Ruby tests, so “100% unit tested” is blocked until those are either implemented or explicitly carved out of scope.

### Interim Review

- Restored Ruby suite health by adding missing `SyncMode`, fixing `PullRequest` review-task validation, and aligning sync job tests with the current `Sync::Orchestrator` architecture.
- Added audit-only SimpleCov mode via `FULL_COVERAGE_AUDIT=1` so repo-wide unit coverage can be measured without breaking the narrow CI gate.
- Fresh Ruby baseline:
  - `SKIP_COVERAGE=1 bin/rails test` => pass (`1117 runs, 0 failures, 0 errors, 84 skips`)
  - `script/check_cli_api_coverage` => pass again at `100%` line and branch for the narrow tracked subset
  - `FULL_COVERAGE_AUDIT=1 bin/rails test` => `1.75%` line coverage, `0.0%` branch coverage across the broader tracked unit surface (`72 / 4104` lines)
- Fresh JS baseline:
  - coverage command now runs after adding `@vitest/coverage-v8`
  - current blocker is test health, not tooling: `11` failing specs plus `1` unhandled Happy DOM/Stimulus environment error

### 2026-03-04 Progress Review

- Stabilized the Ruby suite in single-process SQLite mode:
  - `SKIP_COVERAGE=1 bin/rails test` => pass (`1172 runs, 2951 assertions, 0 failures, 0 errors, 84 skips`)
- Stabilized the JS suite and coverage runner:
  - `npm test` => pass
  - `npm run test:coverage` => pass
- Added missing Ruby tests for:
  - `app/services/sync/**`
  - broadcasters
  - configuration objects
  - helpers
  - presenters
  - channels
  - base app classes
- Added missing JS tests for:
  - `archive_confirmation_controller`
  - `notifications_controller`
  - `submit_confirmation_controller`
  - JS bootstrap files
  - PWA service worker
- Fixed broad test-isolation debt in non-transactional/request/job suites:
  - standardized child-first cleanup for `ReviewComment` / `ReviewIteration` / `AgentLog` / `ReviewTask` / `PullRequest`
  - disabled transactional tests only where SQLite/request behavior required it
  - kept broad model suites transactional to avoid `database is locked` regressions
- Current Ruby unit audit, excluding `test/integration/**` as planned:
  - `FULL_COVERAGE_AUDIT=1 bin/rails test test/channels test/config test/controllers test/helpers test/jobs test/lib test/models test/presenters test/services test/tasks test/validators`
  - result: `1117 runs, 2404 assertions, 0 failures, 0 errors, 84 skips`
  - coverage: `86.48%` line (`2328 / 2692`), `75.59%` branch (`678 / 897`)
- Remaining blockers to true 100%:
  - `84` Ruby skips still need to be replaced or explicitly excluded
  - Ruby branch coverage is still far from target, especially in older model/service/controller files with partial tests
  - JS suite is healthy, but coverage still needs file-by-file expansion to reach enforced `100%`

## Plan

- [x] Add regression tests for `ReviewCommentBuilder` to ensure prose `suggested_fix` is not fenced as code
- [x] Keep code `suggested_fix` rendered as fenced code with language detection
- [x] Tighten `CodeReviewService` prompts so `suggested_fix` is only executable code and prose goes in `comment`
- [x] Improve checklist comment readability styles and metadata wrapping in the review UI
- [x] Run targeted Ruby tests and record results

## Review

- Added failing regression tests first for prose `suggested_fix` being incorrectly fenced as code in `ReviewCommentBuilder`.
- Updated `ReviewCommentBuilder` to classify suggested fixes:
  - code-like text -> keep `**Suggested fix:**` fenced block
  - prose -> append as normal markdown text (no code fence/language label)
- Tightened `CodeReviewService` standard + swarm prompt instructions so `suggested_fix` must be code-only and prose must stay in `comment`.
- Improved checklist comment rendering with better header wrapping, metadata chips, body typography, and code-block container styling.
- Added helper-level `code_suggestion?` detection and used it in parsed-output fallbacks (`review_tasks/show` and review history iteration) to render prose suggestions as markdown instead of code blocks.
- Validation:
  - `SKIP_COVERAGE=1 bin/rails test test/services/review_comment_builder_test.rb test/helpers/review_tasks_helper_test.rb`
  - `SKIP_COVERAGE=1 bin/rails test test/services/code_review_service_test.rb`
  - `bin/rails tailwindcss:build`
- Result: all pass.

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

## 2026-02-24 Global Responsiveness Plan

- [x] Add shared responsive helpers/utilities in Tailwind CSS for horizontal filter controls and overflow safety
- [x] Make Pull Requests page header/filter/status and bulk toolbar responsive on small screens
- [x] Make Review Tasks board header/filter/grid responsive across mobile/tablet/desktop
- [x] Improve repositories/settings/shared overflow behavior for long text/paths
- [x] Run targeted tests and record results

## 2026-02-24 Global Responsiveness Review

- Added shared utility support for overflow-safe filter rows (`no-scrollbar`) and safer filter bar child sizing.
- Updated Pull Requests page controls for mobile:
  - Filter controls now use horizontal scroll on narrow screens instead of wrapping off-canvas.
  - Stats/sync row now collapses cleanly; “last synced” text hides on very small screens.
  - Bulk action toolbar now stacks/actions become full-width on mobile.
- Updated Review Tasks page for responsive behavior:
  - Header now collapses better on small widths.
  - Filter controls now follow the same horizontal-scroll pattern as PR board.
  - Column grid now scales by breakpoint (`1 -> 2 -> 7`) instead of jumping directly to 7 at `md`.
- Updated Repositories page for responsiveness:
  - Header actions stack on small screens.
  - Long filesystem paths now break instead of overflowing.
- Ran:
  `SKIP_COVERAGE=1 bin/rails test test/controllers/pull_requests_controller_test.rb test/controllers/review_tasks_controller_test.rb test/controllers/repositories_controller_test.rb`
- Result: `91 runs, 309 assertions, 0 failures, 0 errors, 1 skip`.

## 2026-02-24 Global Responsiveness Follow-up Review

- User-reported screenshot showed board still clipped on widescreen.
- Root cause: `@media (min-width: 1600px) { .linear-board { justify-content: center; } }` centered an overflowing row, clipping both edges.
- Fix:
  - Removed wide-screen centering for `.linear-board`.
  - Updated large-screen `.linear-column` sizing to allow shrink (`min-width: 240px; flex: 1 1 0%; max-width: none`) so columns fit before requiring horizontal scroll.
- Validation:
  - `bin/rails tailwindcss:build`
  - `SKIP_COVERAGE=1 bin/rails test test/controllers/pull_requests_controller_test.rb`
- Result: build pass, tests pass (`35 runs, 115 assertions, 0 failures`).

## 2026-02-24 Mobile/Tablet Kanban Mode Plan

- [x] Implement phone-first single-column behavior for kanban boards via board filter + column visibility
- [x] Implement tablet grid behavior and desktop board behavior in shared kanban CSS
- [x] Expand mobile-accessible status chips so all important states are reachable on phone
- [x] Verify with CSS build + JS controller tests + impacted Rails controller tests

## 2026-02-24 Mobile/Tablet Kanban Mode Review

- Updated `BoardFilterController` to support:
  - Column state detection for both `data-state` and `data-status`
  - Phone viewport fallback from `all` to a specific state (single-column mode)
  - Column wrapper visibility toggling (hide non-selected columns on phone)
  - Count badge updates for both PR and review-task boards
  - Resize re-application to keep layout/state behavior consistent when changing viewport
- Updated PR filter chips:
  - Hide `All` on phone
  - Add phone chips for `Done` (`reviewed_by_others`) and `Failed` (`review_failed`)
- Updated Review Tasks filter chips:
  - Hide `All` on phone
  - Add phone chips for `Pending`, `Waiting`, and `Done`
- Updated shared kanban CSS to explicit modes:
  - Phone: single-column grid
  - Tablet: 2-column grid
  - Small desktop: 3-column grid
  - Wide desktop: horizontal board
- Ran:
  - `bin/rails tailwindcss:build`
  - `npm test -- test/javascript/controllers/board_filter_controller.test.js`
  - `SKIP_COVERAGE=1 bin/rails test test/controllers/pull_requests_controller_test.rb test/controllers/review_tasks_controller_test.rb`
- Result: all pass.

## 2026-02-24 PR Board Filter Count Mismatch Plan

- [x] Add JS regression test for filtered board where `pr_count_*` badges mismatch visible cards
- [x] Update `board_filter_controller` to recalculate per-column visible counts after filter operations
- [x] Run targeted JS controller tests

## 2026-02-24 PR Board Filter Count Mismatch Review

- Root cause: client-side filters hide cards but do not update `pr_count_*` badges, which remain server totals.
- Added regression test in `test/javascript/controllers/board_filter_controller.test.js`:
  `updates column count badges to match visible cards`.
- Updated `BoardFilterController#applyFilters` to:
  - initialize per-state counts from rendered columns,
  - compute visible counts after search/state/author filtering,
  - update `#pr_count_<state>` badge text per column.
- Ran:
  `npm test -- test/javascript/controllers/board_filter_controller.test.js test/javascript/controllers/kanban_controller.test.js`
- Result: pass (`11 tests`).

## 2026-02-24 Rails API + React/Vite Split Plan

## Plan

- [ ] Freeze API contract for all current UI actions (OpenAPI + JSON examples + error envelope rules)
- [ ] Add missing API endpoints for full feature parity (review tasks lifecycle, review comments lifecycle, settings read/update, repositories list/switch)
- [ ] Move controller business logic into shared service layer used by both web and API paths
- [ ] Add API auth strategy for decoupled frontend (`Authorization` token for web app; keep localhost dev fallback)
- [ ] Add CORS + CSRF strategy for split origins (API-only mode)
- [ ] Add websocket/event protocol for React (`review_task_logs`, `review_notifications`, board updates) without Turbo Stream payloads
- [ ] Build React app (`frontend/`) with Vite, React Router, React Query, and typed API client
- [ ] Implement React pages for parity:
- [ ] PR board
- [ ] review tasks board/detail
- [ ] review comment checklist + submission
- [ ] repositories picker/switch
- [ ] settings
- [ ] Add transitional dual-run mode (`RAILS_UI_ENABLED=true|false`) so Rails views and React can run in parallel during migration
- [ ] Add comprehensive tests:
- [ ] Rails request tests for every endpoint + contract tests
- [ ] React unit/component tests
- [ ] E2E flow tests against split stack
- [ ] Update local/dev orchestration (`bin/dev`) to run Rails API + Vite concurrently
- [ ] Production rollout in 3 stages: shadow traffic, opt-in React UI, default React UI + Rails view retirement

## Review

- Pending approval for implementation.

## 2026-02-24 Approve Without Comments Plan

- [x] Add regression tests for approving with zero selected comments (Rails + Stimulus)
- [x] Allow `ReviewCommentsController#submit` to accept explicit empty approval submissions
- [x] Update submitter payload building to send approval review with no review body/comments
- [x] Update checklist/confirmation UI behavior for approve-without-comments flow
- [x] Run targeted tests and record results

## 2026-02-24 Approve Without Comments Review

- Added regression tests first:
  - `ReviewCommentsControllerTest#submit allows approve without comments when explicitly requested`
  - `comment_checklist_controller` tests for `APPROVE` with zero selected comments and `force_empty_submission` flag injection.
  - `GithubReviewSubmitterTest#submit_empty_review omits review body for approve without summary`.
- Backend changes:
  - `ReviewCommentsController#submit` now accepts explicit empty approval submissions via `force_empty_submission=true` and still rejects empty non-approval submissions.
  - `GithubReviewSubmitter` now omits `body` and `comments` payload keys for empty `APPROVE` reviews (no comment text posted).
- UI/Stimulus changes:
  - `comment_checklist_controller` enables submit when event is `APPROVE` with zero selected comments and adds hidden `force_empty_submission=true` on submit.
  - `event_selector_controller` dispatches `event-selector:changed` so submit button state updates immediately when switching event type.
  - Confirmation modal warning text is now event-aware and explicitly states when approval will be sent without comments.
- Validation:
  - `SKIP_COVERAGE=1 bin/rails test test/controllers/review_comments_controller_test.rb test/services/github_review_submitter_test.rb` -> pass (`84 runs, 0 failures`).
  - `npm test -- test/javascript/controllers/comment_checklist_controller.test.js -t "enables submit with zero selection when event is APPROVE|prepares force_empty_submission for approve without selected comments"` -> pass (`2 tests`).
  - Note: full JS controller files still include pre-existing failing tests unrelated to this change.
- Follow-up fix after live failure report (`Unprocessable Entity`):
  - Added failing repro test:
    `GithubReviewSubmitterTest#submit_review respects explicitly empty comments without falling back to pending`.
  - Fixed `GithubReviewSubmitter#submit_review` to treat explicit empty `comments` as intentional (`comments.nil? ? pending : comments`), preventing unintended fallback to all pending comments.
  - Re-ran targeted tests:
    - `SKIP_COVERAGE=1 bin/rails test test/services/github_review_submitter_test.rb:343 test/services/github_review_submitter_test.rb:330`
    - `SKIP_COVERAGE=1 bin/rails test test/controllers/review_comments_controller_test.rb:201`
  - Result: all pass.

## 2026-02-24 Approval Column Transition Plan

- [x] Add regression test proving `APPROVE` submission should move card to Done lane
- [x] Update review lifecycle transition to mark approved submissions as done
- [x] Re-run targeted controller tests to verify `APPROVE` + `REQUEST_CHANGES` behavior

## 2026-02-24 Approval Column Transition Review

- Added failing-first regression coverage in `ReviewCommentsControllerTest`:
  - `submit with APPROVE moves review to done column`
  - `submit with empty APPROVE moves task/PR to done column`
- Updated `ReviewCommentsController#transition_review_lifecycle!`:
  - `REQUEST_CHANGES` -> `review_task.waiting_implementation` + `pull_request.waiting_implementation`
  - `APPROVE` -> `review_task.done` + `pull_request.reviewed_by_others` (Done lane)
  - `COMMENT` keeps existing reviewed lane behavior.
- Validation:
  - `SKIP_COVERAGE=1 PARALLEL_WORKERS=1 bin/rails test test/controllers/review_comments_controller_test.rb:225 test/controllers/review_comments_controller_test.rb:245 test/controllers/review_comments_controller_test.rb:265`
  - Result: pass.

## 2026-02-24 Sync Stability Fix Plan

- [x] Add failing regression tests for stale reconciliation safety and deleted-PR restore behavior
- [x] Make GitHub sync reconciliation non-destructive (soft delete stale PRs only)
- [x] Skip stale reconciliation when fetched open-PR set is incomplete or requested-only scope is enabled
- [x] Prevent background sync job from restoring deleted PRs not re-fetched from GitHub
- [x] Ensure sync failure broadcast errors do not mask original sync error
- [x] Scope API pull-request listing to current selected repo
- [x] Add DB uniqueness guard for PR identity per repo (`repo_owner`, `repo_name`, `number`)
- [x] Fix manual sync button flow to always reset UI state after request
- [x] Run targeted Rails + JS tests and record output

## 2026-02-24 Sync Stability Fix Review

- Added failing-first regression tests in:
  - `GithubCliServiceTest` for stale reconciliation gating and soft-delete behavior.
  - `SyncPullRequestsJobTest` for deleted-PR preservation and broadcast error handling.
  - `Api::V1::PullRequestsControllerTest` for current-repo scoping.
  - `sync_controller` JS test for manual sync UI reset.
- Backend sync changes:
  - Raised PR fetch limit from `100` to `1000` (`PR_FETCH_LIMIT`).
  - Added completeness tracking for open PR fetches and gated stale reconciliation.
  - Disabled stale reconciliation in requested-only mode.
  - Replaced destructive stale `destroy_all` with soft-delete (`deleted_at`).
  - Removed job-side restoration of deleted PRs not re-fetched from GitHub.
  - Wrapped sync-failure broadcast in safe rescue to preserve original sync exception.
- API and model changes:
  - Scoped `/api/v1/pull_requests` to `PullRequest.for_current_repo(Setting.current_repo)`.
  - Added model-level uniqueness for `number` scoped to repo.
  - Added DB unique index migration: `index_pull_requests_on_repo_and_number_unique`.
- Frontend change:
  - `sync_controller` now runs manual sync via async fetch path and always resets modal/button state in `finally`.
- Validation:
  - `SKIP_COVERAGE=1 bin/rails test test/services/github_cli_service_test.rb test/jobs/sync_pull_requests_job_test.rb test/controllers/api/v1/pull_requests_controller_test.rb test/models/pull_request_test.rb`
  - `SKIP_COVERAGE=1 bin/rails test test/services/github_cli_service_test.rb test/jobs/sync_pull_requests_job_test.rb test/controllers/pull_requests_controller_test.rb test/controllers/api/v1/syncs_controller_test.rb test/controllers/repositories_controller_test.rb test/controllers/api/v1/repositories_controller_test.rb test/controllers/api/v1/reviews_controller_test.rb test/controllers/api/v1/pull_requests_controller_test.rb test/models/pull_request_test.rb`
  - `npm test -- test/javascript/controllers/sync_controller.test.js`
  - Result: all pass.
