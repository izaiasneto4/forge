# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_03_07_120000) do
  create_table "agent_logs", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "log_type", default: "output", null: false
    t.text "message"
    t.integer "review_task_id", null: false
    t.datetime "updated_at", null: false
    t.index ["created_at"], name: "index_agent_logs_on_created_at"
    t.index ["log_type"], name: "index_agent_logs_on_log_type"
    t.index ["review_task_id"], name: "index_agent_logs_on_review_task_id"
  end

  create_table "pull_request_snapshots", force: :cascade do |t|
    t.text "ai_summary_failure_reason"
    t.integer "ai_summary_files_changed"
    t.datetime "ai_summary_generated_at"
    t.integer "ai_summary_lines_added"
    t.integer "ai_summary_lines_removed"
    t.text "ai_summary_main_changes"
    t.text "ai_summary_risk_areas"
    t.string "ai_summary_status", default: "none", null: false
    t.string "base_sha", null: false
    t.datetime "created_at", null: false
    t.string "head_sha", null: false
    t.integer "pull_request_id", null: false
    t.string "stale_reason"
    t.string "status", default: "current", null: false
    t.datetime "synced_at"
    t.datetime "updated_at", null: false
    t.index ["ai_summary_status"], name: "index_pull_request_snapshots_on_ai_summary_status"
    t.index ["pull_request_id", "head_sha", "base_sha"], name: "index_pr_snapshots_on_pull_request_and_revision", unique: true
    t.index ["pull_request_id", "status"], name: "index_pr_snapshots_on_pull_request_and_status"
    t.index ["pull_request_id"], name: "index_pull_request_snapshots_on_pull_request_id"
  end

  create_table "pull_requests", force: :cascade do |t|
    t.integer "additions"
    t.boolean "archived", default: false, null: false
    t.string "author"
    t.string "author_avatar"
    t.string "base_ref"
    t.string "base_sha"
    t.integer "changed_files"
    t.string "check_status"
    t.datetime "closed_at_github"
    t.datetime "created_at", null: false
    t.datetime "created_at_github"
    t.datetime "deleted_at"
    t.integer "deletions"
    t.text "description"
    t.boolean "draft", default: false, null: false
    t.integer "github_id"
    t.string "head_ref"
    t.string "head_sha"
    t.string "inactive_reason"
    t.string "latest_review_state"
    t.datetime "merged_at_github"
    t.integer "number"
    t.string "remote_state", default: "open", null: false
    t.string "repo_name"
    t.string "repo_owner"
    t.string "review_decision"
    t.boolean "review_requested_for_me", default: false, null: false
    t.string "review_status"
    t.integer "review_tasks_count", default: 0
    t.string "title"
    t.datetime "updated_at", null: false
    t.datetime "updated_at_github"
    t.string "url"
    t.index ["deleted_at"], name: "index_pull_requests_on_deleted_at"
    t.index ["github_id"], name: "index_pull_requests_on_github_id"
    t.index ["head_sha"], name: "index_pull_requests_on_head_sha"
    t.index ["inactive_reason"], name: "index_pull_requests_on_inactive_reason"
    t.index ["remote_state"], name: "index_pull_requests_on_remote_state"
    t.index ["repo_owner", "repo_name", "archived", "deleted_at", "review_status"], name: "index_pull_requests_repo_filter"
    t.index ["repo_owner", "repo_name", "number"], name: "index_pull_requests_on_repo_and_number_unique", unique: true
    t.index ["repo_owner", "repo_name", "remote_state", "inactive_reason"], name: "index_pull_requests_on_repo_active_state"
    t.index ["repo_owner", "repo_name"], name: "index_pull_requests_on_repo_owner_and_name"
    t.index ["review_requested_for_me"], name: "index_pull_requests_on_review_requested_for_me"
    t.index ["review_status"], name: "index_pull_requests_on_review_status"
    t.index ["review_tasks_count"], name: "index_pull_requests_on_review_tasks_count"
    t.index ["updated_at_github"], name: "index_pull_requests_on_updated_at_github"
  end

  create_table "review_comments", force: :cascade do |t|
    t.text "body", null: false
    t.datetime "created_at", null: false
    t.string "file_path", null: false
    t.integer "line_number"
    t.text "resolution_note"
    t.integer "review_task_id", null: false
    t.string "severity", default: "suggestion", null: false
    t.string "status", default: "pending", null: false
    t.string "title"
    t.datetime "updated_at", null: false
    t.index ["file_path"], name: "index_review_comments_on_file_path"
    t.index ["review_task_id", "file_path"], name: "index_review_comments_on_review_task_id_and_file_path"
    t.index ["review_task_id"], name: "index_review_comments_on_review_task_id"
    t.index ["severity"], name: "index_review_comments_on_severity"
    t.index ["status"], name: "index_review_comments_on_status"
  end

  create_table "review_iterations", force: :cascade do |t|
    t.string "ai_model"
    t.string "cli_client", null: false
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.string "from_state", null: false
    t.integer "iteration_number", default: 1, null: false
    t.text "review_output"
    t.integer "review_task_id", null: false
    t.string "review_type", default: "review", null: false
    t.datetime "started_at"
    t.string "to_state", null: false
    t.datetime "updated_at", null: false
    t.index ["ai_model"], name: "index_review_iterations_on_ai_model"
    t.index ["review_task_id", "iteration_number"], name: "index_review_iterations_on_review_task_id_and_iteration_number", unique: true
    t.index ["review_task_id"], name: "index_review_iterations_on_review_task_id"
  end

  create_table "review_tasks", force: :cascade do |t|
    t.string "ai_model"
    t.boolean "archived", default: false, null: false
    t.string "cli_client", default: "claude", null: false
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.text "failure_reason"
    t.datetime "last_retry_at"
    t.integer "pull_request_id", null: false
    t.integer "pull_request_snapshot_id"
    t.datetime "queued_at"
    t.integer "retry_count", default: 0, null: false
    t.text "retry_history"
    t.text "review_output"
    t.string "review_type", default: "review", null: false
    t.datetime "started_at"
    t.string "state", default: "pending_review", null: false
    t.string "submission_status", default: "pending_submission"
    t.datetime "submitted_at"
    t.string "submitted_event"
    t.datetime "updated_at", null: false
    t.string "worktree_path"
    t.index ["ai_model"], name: "index_review_tasks_on_ai_model"
    t.index ["pull_request_id", "state"], name: "index_review_tasks_on_pull_request_id_and_state"
    t.index ["pull_request_id"], name: "index_review_tasks_on_pull_request_id"
    t.index ["pull_request_snapshot_id"], name: "index_review_tasks_on_pull_request_snapshot_id"
    t.index ["retry_count"], name: "index_review_tasks_on_retry_count"
    t.index ["state", "archived"], name: "index_review_tasks_state_archived"
    t.index ["state", "queued_at"], name: "index_review_tasks_on_state_and_queued_at"
    t.index ["state"], name: "index_review_tasks_on_state"
    t.index ["submission_status"], name: "index_review_tasks_on_submission_status"
    t.index ["submitted_event"], name: "index_review_tasks_on_submitted_event"
  end

  create_table "settings", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "key"
    t.datetime "updated_at", null: false
    t.text "value"
    t.index ["key"], name: "index_settings_on_key", unique: true
  end

  create_table "sync_states", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "created_count", default: 0, null: false
    t.integer "deactivated_count", default: 0, null: false
    t.integer "fetched_count", default: 0, null: false
    t.text "last_error"
    t.datetime "last_finished_at"
    t.datetime "last_started_at"
    t.datetime "last_succeeded_at"
    t.string "repo_name"
    t.string "repo_owner"
    t.string "scope_key", null: false
    t.string "status", default: "idle", null: false
    t.datetime "updated_at", null: false
    t.integer "updated_count", default: 0, null: false
    t.index ["scope_key"], name: "index_sync_states_on_scope_key", unique: true
  end

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email", default: "", null: false
    t.string "encrypted_password", default: "", null: false
    t.datetime "remember_created_at"
    t.datetime "reset_password_sent_at"
    t.string "reset_password_token"
    t.string "role", default: "user", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["reset_password_token"], name: "index_users_on_reset_password_token", unique: true
  end

  add_foreign_key "agent_logs", "review_tasks"
  add_foreign_key "pull_request_snapshots", "pull_requests"
  add_foreign_key "review_comments", "review_tasks"
  add_foreign_key "review_iterations", "review_tasks"
  add_foreign_key "review_tasks", "pull_request_snapshots"
  add_foreign_key "review_tasks", "pull_requests"
end
