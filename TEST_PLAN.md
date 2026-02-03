# Test Coverage Plan

Goal: cover all production code with unit tests and add a small, stable end-to-end Playwright suite for pipeline confidence.

## Existing Coverage (as of now)
- Services: `app/services/line_range_parser.rb`, `app/services/folder_picker_service.rb` (partial), `app/services/github_cli_service.rb` (partial), `app/services/worktree_service.rb` (partial)
- Validators: `app/validators/path_validator.rb`
- Presenters: `app/presenters/header_presenter.rb`
- Controllers: `app/controllers/settings_controller.rb`
- E2E: `retry-verification.spec.ts` (review tasks board retry UI)

## Missing Unit Test Specs (Ruby)

### Models
- `app/models/pull_request.rb`
  - Validations: required fields, `review_status` inclusion, uniqueness of `github_id`
  - `review_status_consistency`:
    - `reviewed_by_me` without `review_task` is invalid
    - `reviewed_by_me` with `review_task` not in `reviewed`/`waiting_implementation`/`done` is invalid
    - `in_review` without `review_task` is invalid; mismatch state invalid
    - `review_failed` without `review_task` is invalid; mismatch state invalid
  - Scopes/default scope:
    - `default_scope` excludes `deleted_at`
    - `deleted`/`not_deleted` correctness
  - Methods:
    - `repo_full_name` formats `owner/name`
    - `short_description` truncates
    - `soft_delete!` sets `deleted_at`, `deleted?` true
    - `restore!` resets `deleted_at` and `review_status` to `pending_review`
  - Class methods:
    - `fix_orphaned_review_states` resets state for PRs in review states without `review_task`
    - `fix_state_mismatches`:
      - PR `in_review` + task `pending_review` => PR becomes `pending_review`
      - PR `reviewed_by_me` + task `in_review` => PR becomes `in_review`
      - PR `reviewed_by_me` + task `pending_review` => PR becomes `pending_review`
  - Callback:
    - `after_commit` invalidates header cache (stub `HeaderPresenter.invalidate_cache`)

- `app/models/review_task.rb`
  - Validations: `state`, `cli_client`, `review_type`
  - Scopes for each state
  - State transitions:
    - `start_review!` sets `state`, `started_at`, updates PR status
    - `complete_review!` sets `state`, `review_output`, `completed_at`, updates PR status
    - `mark_waiting_implementation!`, `mark_done!`
    - `mark_failed!` sets state, `failure_reason`, `completed_at`, updates PR status, writes retry history
    - `retry_review!` only when `failed_review?` and `can_retry?`
  - Retry logic:
    - `can_retry?`, `retries_exhausted?`
    - `increment_retry!` updates count/time/history
    - `reset_retry_state!` clears retry fields
    - `backoff_seconds` exponential (base 2)
    - `parsed_retry_history` handles invalid JSON
  - Review output:
    - `parsed_review_items` delegates to `ReviewOutputParser.parse`
  - Logs:
    - `add_log` ignores blank, `clear_logs!` removes logs
  - Backward movement:
    - `backward_movement?` detects ordering and ignores `failed_review`
    - `archive_current_review!` creates `ReviewIteration` when output/comments exist
    - `reset_for_new_review!` clears comments/logs and resets fields
    - `move_backward!` wraps archive + reset + state change; returns false when not backward
  - History helpers: `current_iteration_number`, `review_history`, `has_review_history?`
  - Class method: `reset_stuck_tasks`:
    - resets only tasks with `started_at` older than threshold and no recent logs
    - clears logs and sets `failure_reason`, `worktree_path` nil
  - Callback:
    - `before_destroy` resets PR status if PR is reviewed/in_review/failed
    - `after_commit` broadcasts on state changes (stub ActionCable/Turbo)

- `app/models/review_comment.rb`
  - Validations: `file_path`, `body`, `severity`, `status`
  - Scopes: `pending`, `addressed`, `dismissed`, `critical`, `major`, `minor`, `suggestions`, `nitpicks`, `actionable`, `for_file`, `by_severity`
  - Predicates: `pending?`, `addressed?`, `dismissed?`, severity helpers
  - `actionable?` true for `critical`/`major`/`minor`
  - `mark_addressed!`, `mark_dismissed!` update status and resolution_note
  - `location` with/without line_number

- `app/models/review_iteration.rb`
  - Validations: `iteration_number` uniqueness scoped to `review_task`
  - Scopes: `chronological`, `reverse_chronological`
  - `duration_seconds` returns nil without timestamps
  - `swarm_review?` true only for `review_type == "swarm"`

- `app/models/setting.rb`
  - Validations: `key` presence/uniqueness
  - `repos_folder`, `current_repo` getters/setters store records
  - `default_cli_client` falls back to default when unset
  - `default_cli_client=` ignores invalid values
  - `last_synced_at` parses ISO8601, returns nil on invalid data
  - `touch_last_synced!`, `sync_needed?`, `seconds_until_sync_allowed`
  - Edge: when `last_synced_at` is nil, `sync_needed?` true

- `app/models/agent_log.rb`
  - Validations: `log_type`, `message`
  - Scope: `recent` order
  - Callback: `after_create_commit` broadcasts to ActionCable (stub broadcast)

### Services
- `app/services/review_output_parser.rb`
  - Extracts JSON block when wrapped in ```json
  - Returns empty array when no JSON block
  - Handles invalid JSON gracefully (logs warning, returns [])
  - Skips non-array JSON
  - Filters non-hash items
  - Normalizes severity mapping: `error/critical/bug => :error`, `warning/issue/concern => :warning`, else `:info`

- `app/services/review_errors.rb`
  - `ErrorClassifier.classify` selects correct error classes for each pattern
  - Unknown errors default to `TransientError`
  - `.transient?` and `.permanent?` helpers
  - `RateLimitError` includes `reset_at`

- `app/services/claude_review_service.rb`
  - Delegates to `CodeReviewService.for` with `cli_client: "claude"`
  - `run_review` and `run_review_streaming` proxy

- `app/services/review_comment_builder.rb`
  - `persist_all` returns empty array when no items
  - `create_comments_from_items` creates comments in transaction
  - `parse_line_number` handles nil/blank and range strings
  - `map_severity` defaults to "suggestion"
  - `build_comment_body` appends suggested_fix block
  - Raises `Error` when `ReviewComment` invalid

- `app/services/model_detector.rb`
  - `detect` dispatches to correct method by cli_client
  - `detect_opencode_model`:
    - missing file => `UNKNOWN_MODEL`
    - malformed JSON => `UNKNOWN_MODEL`
    - provider present => `provider/model`
  - `detect_codex_model`:
    - missing file => `UNKNOWN_MODEL`
    - TOML without `model =` => `UNKNOWN_MODEL`
  - `detect_claude_model`:
    - env var precedence
    - config file parsing
    - malformed JSON => "claude"

- `app/services/repo_scanner_service.rb`
  - returns [] when base folder missing/blank
  - ignores dot-entries
  - includes only folders with `.git`
  - sorts case-insensitively by name
  - captures `remote_url` and `branch` (stub backticks)

- `app/services/github_cli_service.rb`
  - `fetch_review_requests` and `fetch_reviewed_by_me` parse JSON and set `review_status`
  - `fetch_all_prs_needing_attention` excludes reviewed IDs from pending
  - `sync_to_database!`:
    - creates PRs
    - preserves existing `review_status` when PR already persisted
    - calls `remove_stale_prs` and `mark_reviewed_by_others`
  - `run_gh_command` raises `GithubCliService::Error` on non-zero
  - `get_repo_info`:
    - invalid path returns nil
    - parses SSH/HTTPS GitHub remotes
    - non-GitHub remotes return nil
  - `parse_prs`:
    - handles missing URL, author, headRepositoryOwner
    - `extract_github_id` returns stable integer for URL string
  - `remove_stale_prs`:
    - deletes PRs not in fetched set for current repo
    - logs and handles foreign key failures (raise Error)
  - `mark_reviewed_by_others`:
    - only pending PRs without review_task
    - updates to `reviewed_by_others` when no review requests
  - `fetch_latest_for_repo`:
    - no-op when `repo_path` missing or non-existent
    - calls `git fetch` and `git pull` (stub `system`)

- `app/services/worktree_service.rb`
  - `initialize` expands paths (already partially covered)
  - `create_for_pr`:
    - cleans existing worktree
    - fetches PR ref and adds worktree
  - `cleanup_worktree`:
    - removes via git, then rm_rf
  - `cleanup_all` prunes and removes base dir
  - `fetch_pr_branch` falls back to `pr-N` on gh error/invalid JSON
  - `fetch_pr_ref` retry logic on transient errors
  - `with_retry`:
    - retries transient errors up to MAX_RETRIES
    - raises `NetworkError` after exhaustion
  - `create_worktree`:
    - invalid path => raises Error
    - fallback to `FETCH_HEAD` when branch add fails

- `app/services/review_output_parser.rb` (see above)

- `app/services/code_review_service.rb`
  - `.for` selects correct client config and defaults
  - `detect_model` delegates to `ModelDetector`
  - `run_review`:
    - raises when worktree missing
    - handles stderr and non-success statuses
  - `run_review_streaming` yields lines to block
  - `review_prompt` chooses standard vs swarm

- `app/services/github_review_submitter.rb`
  - `validate_event!` rejects unknown
  - `submit_review`:
    - no comments => uses empty review body/event
    - event is optional and defaults based on severity
  - `build_review_body` format, severity counts, and footer
  - `determine_event` uses critical/major => REQUEST_CHANGES
  - `build_review_comments` skips comments without file_path
  - `build_comment_payload` includes line/side when line_number set
  - `build_single_comment_payload` includes commit_id and line/side
  - `parse_api_error` error class mapping:
    - rate limit => `RateLimitError` with reset time
    - auth => `AuthenticationError`
    - 404 => `NotFoundError`
    - stale diff => `StaleDiffError` with file
    - blocked => `SubmissionBlockedError`
  - `format_user_friendly_error` trims/normalizes long message
  - `run_gh_api` handles non-JSON responses and raises friendly errors

### Jobs
- `app/jobs/sync_pull_requests_job.rb`
  - happy path:
    - fetch latest for repo
    - sync to DB
    - restore deleted PRs
    - touch last synced
    - broadcast completed
  - error path: broadcast failed and re-raise
  - `restore_deleted_prs`:
    - re-synced PR resets to pending and leaves deleted record deleted
    - still-deleted PR is restored

- `app/jobs/review_task_job.rb`
  - happy path:
    - clears logs on initial attempt
    - builds worktree, starts review, stores model
    - streams output and validates
    - completes review and creates comments
    - broadcasts completion
  - validation errors:
    - blank output => `ReviewErrors::ValidationError`
    - truncated error output => classifier invoked
  - transient errors:
    - `WorktreeService::NetworkError` schedules retry
    - `ReviewErrors::TransientError` schedules retry
  - permanent errors:
    - `ReviewErrors::PermanentError` marks failed
  - unknown errors:
    - retryable vs non-retryable handling
  - ensure block:
    - cleans up worktree when `worktree_path` present

### Channels
- `app/channels/review_task_logs_channel.rb`
  - `subscribed` streams from correct channel using `review_task_id`
  - `unsubscribed` stops streams

### Controllers (request/integration specs)
- `app/controllers/pull_requests_controller.rb`
  - `index` assigns all columns
  - `sync`:
    - respects debounce unless `force`
    - HTML/JSON/Turbo responses
    - error handling on `GithubCliService::Error`
  - `update_status` success vs invalid status
  - `bulk_destroy`:
    - no ids => 400/bad_request
    - >100 ids => 400/bad_request
    - deletes and returns count on success
  - `async_sync` enqueues job

- `app/controllers/review_tasks_controller.rb`
  - `index` groups states correctly
  - `create`:
    - uses default cli client/review_type
    - enqueues `ReviewTaskJob`
  - `update_state`:
    - valid state update
    - backward move path uses `move_backward!`
    - invalid state => 422
  - `retry`:
    - only allowed on failed state
    - refuses when max retries reached
    - enqueues `ReviewTaskJob` on success

- `app/controllers/review_comments_controller.rb`
  - `toggle` cycles status
  - `submit`:
    - no selected => 422 and error message
    - success => status updated to addressed
    - error from `GithubReviewSubmitter` shows alert
    - comment_ids param limits selection

- `app/controllers/repositories_controller.rb`
  - `index` shows repos when setting present
  - `list` renders partial with locals
  - `switch`:
    - invalid path returns error
    - success updates `Setting.current_repo`, syncs, touches timestamp
    - error from `GithubCliService` returns alert but still sets repo

- `app/controllers/application_controller.rb`
  - `set_header_presenter` runs and assigns presenter

### Helpers
- `app/helpers/review_tasks_helper.rb`
  - `cli_client_icon` returns SVG with custom class, returns "" for unknown
  - `severity_emoji` for all severities/unknown
  - `severity_border_class`, `severity_badge_class`, `status_badge_class`, `state_badge_class`, `log_type_class`
  - `format_review_duration`:
    - nil when missing timestamps
    - <60s, minutes+seconds, hours+minutes cases
  - `render_markdown`:
    - blank returns ""
    - renders markdown to HTML with code blocks
  - `render_code_block`:
    - uses language override
    - default language detection
    - HTML escapes code in copy button
  - `detect_language_from_file` returns correct language for extension, nil for blank

- `app/helpers/application_helper.rb`, `app/helpers/pull_requests_helper.rb`
  - Empty: no tests required unless helpers are added later.

### Validators
- `app/validators/path_validator.rb`
  - Already covered; add edge case for `allowed_base` realpath missing if needed.

### Rake Tasks
- `lib/tasks/pull_requests.rake`
  - `pull_requests:fix_orphaned_states` prints correct message when 0 vs >0
  - `pull_requests:validate_consistency` prints errors for inconsistent PRs

## Missing Unit Test Specs (JavaScript)
Use a JS test runner (Jest/Vitest) + jsdom + @hotwired/stimulus test helpers.

- `app/javascript/controllers/kanban_controller.js`
  - drag/drop adds/removes classes and updates status
  - `updateStatus` success path renders Turbo stream
  - error path triggers reload
  - `markAsReviewed` only moves from pending to reviewed_by_me
  - `updateColumnCounts` reflects card count

- `app/javascript/controllers/copy_controller.js`
  - successful copy writes to clipboard, updates button text, reverts after timeout
  - failure logs error and does not throw

- `app/javascript/controllers/review_accordion_controller.js`
  - toggle adds/removes `is-expanded`
  - `expandAll`/`collapseAll`

- `app/javascript/controllers/review_modal_controller.js`
  - `open` populates targets and disables body scroll
  - `close` resets modal + body
  - escape/backdrop closes
  - `updateIcon` uses selected client icon
  - `submit`:
    - success closes and renders stream
    - failure surfaces alert with message

- `app/javascript/controllers/cli_client_icon_controller.js`
  - updates icon and preserves size classes

- `app/javascript/controllers/agent_logs_controller.js`
  - subscribes/unsubscribes ActionCable
  - `handleMessage` reload on completed; appends log otherwise
  - `getLogClass` mappings
  - `scrollToBottom` behavior

- `app/javascript/controllers/comment_checklist_controller.js`
  - selection tracking, select/deselect all, toggle all, counter text
  - disabled checkboxes are excluded
  - submit button enable/disable classes
  - keyboard shortcuts
  - `prepareSubmission` inserts hidden inputs

- `app/javascript/controllers/repo_selector_controller.js`
  - dropdown toggles and closes on outside click
  - `selectRepo` calls API, updates label, shows loading, renders turbo
  - error path reloads

- `app/javascript/controllers/folder_picker_controller.js`
  - disables/enables button during request
  - sets input value on success

- `app/javascript/controllers/review_kanban_controller.js`
  - drag/drop, drop preview, rollback on failure
  - keyboard move flow (grab/drop/cancel)
  - backward movement confirmation modal
  - `updateState` success renders stream; failure shows toast + rollback
  - announce messages for a11y

- `app/javascript/controllers/event_selector_controller.js`
  - toggles dropdown, sets selected value/label/icon, closes

- `app/javascript/controllers/review_comments_controller.js`
  - submit success renders stream and restores button state
  - submit failure alerts and restores button state

- `app/javascript/controllers/flash_controller.js`
  - auto-dismiss respects delay
  - manual dismiss removes element

- `app/javascript/controllers/bulk_actions_controller.js`
  - selection count, toolbar visibility, delete button state
  - select all checkbox indeterminate state
  - confirm delete flow success/failure

- `app/javascript/controllers/sync_controller.js`
  - autoSync/forceSync toggles spinner and modal
  - sync in progress blocks new requests
  - error path logs and resets

- `app/javascript/controllers/hello_controller.js`
  - connect sets text

## Suggested Integration/E2E Tests (Playwright)
Add stable, low-flake tests using test DB fixtures or factories.

- Review task lifecycle:
  - create review task from PR card
  - verify task moves through columns with streaming logs mocked
  - retry flow when failed review exists
- PR sync flow:
  - run sync and verify counts updated
  - debounce message when sync too soon
- Review comments flow:
  - select comments, submit, verify status updated to addressed
  - handle no selection error
- Repository switch:
  - switch repo and verify PR board updates
- Settings:
  - update repos folder + cli client via UI

## Test Infrastructure Notes
- Use `ActiveJob::TestHelper`, `ActionCable::TestHelper`, `ActiveSupport::Testing::TimeHelpers`.
- Stub `Open3.capture3`, `Open3.popen3`, `Open3.popen2e`, and `system` to avoid network/CLI in unit tests.
- Consider `WebMock` or `Mocha` for stubbing, or use plain Ruby stubs with `Minitest::Mock`.
- Add fixtures/factories for PullRequest, ReviewTask, ReviewComment, ReviewIteration.
