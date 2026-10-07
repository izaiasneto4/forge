import { sqliteTable, index, uniqueIndex, integer, text } from 'drizzle-orm/sqlite-core'
import { railsBoolean, railsDatetime } from './columns'

export const pullRequests = sqliteTable(
  'pull_requests',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    additions: integer(),
    archived: railsBoolean().default(false).notNull(),
    author: text(),
    authorAvatar: text('author_avatar'),
    baseRef: text('base_ref'),
    baseSha: text('base_sha'),
    changedFiles: integer('changed_files'),
    checkStatus: text('check_status'),
    closedAtGithub: railsDatetime('closed_at_github'),
    createdAt: railsDatetime('created_at').notNull(),
    createdAtGithub: railsDatetime('created_at_github'),
    deletedAt: railsDatetime('deleted_at'),
    deletions: integer(),
    description: text(),
    draft: railsBoolean().default(false).notNull(),
    githubId: integer('github_id'),
    headRef: text('head_ref'),
    headSha: text('head_sha'),
    inactiveReason: text('inactive_reason'),
    latestReviewState: text('latest_review_state'),
    mergedAtGithub: railsDatetime('merged_at_github'),
    number: integer(),
    remoteState: text('remote_state').default('open').notNull(),
    repoName: text('repo_name'),
    repoOwner: text('repo_owner'),
    reviewDecision: text('review_decision'),
    reviewRequestedForMe: railsBoolean('review_requested_for_me').default(false).notNull(),
    reviewStatus: text('review_status'),
    reviewTasksCount: integer('review_tasks_count').default(0),
    title: text(),
    updatedAt: railsDatetime('updated_at').notNull(),
    updatedAtGithub: railsDatetime('updated_at_github'),
    url: text(),
  },
  (table) => [
    index('index_pull_requests_on_updated_at_github').on(table.updatedAtGithub),
    index('index_pull_requests_on_review_tasks_count').on(table.reviewTasksCount),
    index('index_pull_requests_on_review_status').on(table.reviewStatus),
    index('index_pull_requests_on_review_requested_for_me').on(table.reviewRequestedForMe),
    index('index_pull_requests_on_repo_owner_and_name').on(table.repoOwner, table.repoName),
    index('index_pull_requests_on_repo_active_state').on(table.repoOwner, table.repoName, table.remoteState, table.inactiveReason),
    uniqueIndex('index_pull_requests_on_repo_and_number_unique').on(table.repoOwner, table.repoName, table.number),
    index('index_pull_requests_repo_filter').on(table.repoOwner, table.repoName, table.archived, table.deletedAt, table.reviewStatus),
    index('index_pull_requests_on_remote_state').on(table.remoteState),
    index('index_pull_requests_on_inactive_reason').on(table.inactiveReason),
    index('index_pull_requests_on_head_sha').on(table.headSha),
    index('index_pull_requests_on_github_id').on(table.githubId),
    index('index_pull_requests_on_deleted_at').on(table.deletedAt),
  ],
)

export const settings = sqliteTable(
  'settings',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    createdAt: railsDatetime('created_at').notNull(),
    key: text(),
    updatedAt: railsDatetime('updated_at').notNull(),
    value: text(),
  },
  (table) => [uniqueIndex('index_settings_on_key').on(table.key)],
)

export const syncStates = sqliteTable(
  'sync_states',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    createdAt: railsDatetime('created_at').notNull(),
    createdCount: integer('created_count').default(0).notNull(),
    deactivatedCount: integer('deactivated_count').default(0).notNull(),
    fetchedCount: integer('fetched_count').default(0).notNull(),
    lastError: text('last_error'),
    lastFinishedAt: railsDatetime('last_finished_at'),
    lastStartedAt: railsDatetime('last_started_at'),
    lastSucceededAt: railsDatetime('last_succeeded_at'),
    repoName: text('repo_name'),
    repoOwner: text('repo_owner'),
    scopeKey: text('scope_key').notNull(),
    status: text().default('idle').notNull(),
    updatedAt: railsDatetime('updated_at').notNull(),
    updatedCount: integer('updated_count').default(0).notNull(),
  },
  (table) => [uniqueIndex('index_sync_states_on_scope_key').on(table.scopeKey)],
)

export const users = sqliteTable(
  'users',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    createdAt: railsDatetime('created_at').notNull(),
    email: text().default('').notNull(),
    encryptedPassword: text('encrypted_password').default('').notNull(),
    rememberCreatedAt: railsDatetime('remember_created_at'),
    resetPasswordSentAt: railsDatetime('reset_password_sent_at'),
    resetPasswordToken: text('reset_password_token'),
    role: text().default('user').notNull(),
    updatedAt: railsDatetime('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('index_users_on_reset_password_token').on(table.resetPasswordToken),
    uniqueIndex('index_users_on_email').on(table.email),
  ],
)

export const agentLogs = sqliteTable(
  'agent_logs',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    createdAt: railsDatetime('created_at').notNull(),
    logType: text('log_type').default('output').notNull(),
    message: text(),
    reviewTaskId: integer('review_task_id')
      .notNull()
      .references(() => reviewTasks.id),
    updatedAt: railsDatetime('updated_at').notNull(),
  },
  (table) => [
    index('index_agent_logs_on_review_task_id').on(table.reviewTaskId),
    index('index_agent_logs_on_log_type').on(table.logType),
    index('index_agent_logs_on_created_at').on(table.createdAt),
  ],
)

export const pullRequestSnapshots = sqliteTable(
  'pull_request_snapshots',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    aiSummaryFailureReason: text('ai_summary_failure_reason'),
    aiSummaryFilesChanged: integer('ai_summary_files_changed'),
    aiSummaryGeneratedAt: railsDatetime('ai_summary_generated_at'),
    aiSummaryLinesAdded: integer('ai_summary_lines_added'),
    aiSummaryLinesRemoved: integer('ai_summary_lines_removed'),
    aiSummaryMainChanges: text('ai_summary_main_changes'),
    aiSummaryRiskAreas: text('ai_summary_risk_areas'),
    aiSummaryStatus: text('ai_summary_status').default('none').notNull(),
    baseSha: text('base_sha').notNull(),
    createdAt: railsDatetime('created_at').notNull(),
    headSha: text('head_sha').notNull(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id),
    staleReason: text('stale_reason'),
    status: text().default('current').notNull(),
    syncedAt: railsDatetime('synced_at'),
    updatedAt: railsDatetime('updated_at').notNull(),
  },
  (table) => [
    index('index_pull_request_snapshots_on_pull_request_id').on(table.pullRequestId),
    index('index_pr_snapshots_on_pull_request_and_status').on(table.pullRequestId, table.status),
    uniqueIndex('index_pr_snapshots_on_pull_request_and_revision').on(table.pullRequestId, table.headSha, table.baseSha),
    index('index_pull_request_snapshots_on_ai_summary_status').on(table.aiSummaryStatus),
  ],
)

export const reviewComments = sqliteTable(
  'review_comments',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    body: text().notNull(),
    createdAt: railsDatetime('created_at').notNull(),
    filePath: text('file_path').notNull(),
    lineNumber: integer('line_number'),
    resolutionNote: text('resolution_note'),
    reviewTaskId: integer('review_task_id')
      .notNull()
      .references(() => reviewTasks.id),
    severity: text().default('suggestion').notNull(),
    status: text().default('pending').notNull(),
    title: text(),
    updatedAt: railsDatetime('updated_at').notNull(),
  },
  (table) => [
    index('index_review_comments_on_status').on(table.status),
    index('index_review_comments_on_severity').on(table.severity),
    index('index_review_comments_on_review_task_id').on(table.reviewTaskId),
    index('index_review_comments_on_review_task_id_and_file_path').on(table.reviewTaskId, table.filePath),
    index('index_review_comments_on_file_path').on(table.filePath),
  ],
)

export const reviewIterations = sqliteTable(
  'review_iterations',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    aiModel: text('ai_model'),
    cliClient: text('cli_client').notNull(),
    completedAt: railsDatetime('completed_at'),
    createdAt: railsDatetime('created_at').notNull(),
    fromState: text('from_state').notNull(),
    iterationNumber: integer('iteration_number').default(1).notNull(),
    reviewOutput: text('review_output'),
    reviewTaskId: integer('review_task_id')
      .notNull()
      .references(() => reviewTasks.id),
    reviewType: text('review_type').default('review').notNull(),
    startedAt: railsDatetime('started_at'),
    toState: text('to_state').notNull(),
    updatedAt: railsDatetime('updated_at').notNull(),
  },
  (table) => [
    index('index_review_iterations_on_review_task_id').on(table.reviewTaskId),
    uniqueIndex('index_review_iterations_on_review_task_id_and_iteration_number').on(table.reviewTaskId, table.iterationNumber),
    index('index_review_iterations_on_ai_model').on(table.aiModel),
  ],
)

export const reviewTasks = sqliteTable(
  'review_tasks',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    aiModel: text('ai_model'),
    archived: railsBoolean().default(false).notNull(),
    cliClient: text('cli_client').default('claude').notNull(),
    completedAt: railsDatetime('completed_at'),
    createdAt: railsDatetime('created_at').notNull(),
    failureReason: text('failure_reason'),
    lastRetryAt: railsDatetime('last_retry_at'),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id),
    pullRequestSnapshotId: integer('pull_request_snapshot_id').references(() => pullRequestSnapshots.id),
    queuedAt: railsDatetime('queued_at'),
    retryCount: integer('retry_count').default(0).notNull(),
    retryHistory: text('retry_history'),
    reviewOutput: text('review_output'),
    reviewType: text('review_type').default('review').notNull(),
    startedAt: railsDatetime('started_at'),
    state: text().default('pending_review').notNull(),
    submissionStatus: text('submission_status').default('pending_submission'),
    submittedAt: railsDatetime('submitted_at'),
    submittedEvent: text('submitted_event'),
    updatedAt: railsDatetime('updated_at').notNull(),
    worktreePath: text('worktree_path'),
  },
  (table) => [
    index('index_review_tasks_on_submitted_event').on(table.submittedEvent),
    index('index_review_tasks_on_submission_status').on(table.submissionStatus),
    index('index_review_tasks_on_state').on(table.state),
    index('index_review_tasks_on_state_and_queued_at').on(table.state, table.queuedAt),
    index('index_review_tasks_state_archived').on(table.state, table.archived),
    index('index_review_tasks_on_retry_count').on(table.retryCount),
    index('index_review_tasks_on_pull_request_snapshot_id').on(table.pullRequestSnapshotId),
    index('index_review_tasks_on_pull_request_id').on(table.pullRequestId),
    index('index_review_tasks_on_pull_request_id_and_state').on(table.pullRequestId, table.state),
    index('index_review_tasks_on_ai_model').on(table.aiModel),
  ],
)

// Bun-owned: replaces Solid Queue for background jobs.
export const jobs = sqliteTable(
  'jobs',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    name: text().notNull(),
    payload: text().default('{}').notNull(),
    state: text().default('ready').notNull(),
    runAt: railsDatetime('run_at').notNull(),
    attempts: integer().default(0).notNull(),
    error: text(),
    claimedAt: railsDatetime('claimed_at'),
    finishedAt: railsDatetime('finished_at'),
    createdAt: railsDatetime('created_at').notNull(),
    updatedAt: railsDatetime('updated_at').notNull(),
  },
  (table) => [
    index('index_jobs_on_state_and_run_at').on(table.state, table.runAt),
    index('index_jobs_on_name_and_state').on(table.name, table.state),
  ],
)
