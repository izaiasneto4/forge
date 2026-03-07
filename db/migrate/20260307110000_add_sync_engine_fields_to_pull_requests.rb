class AddSyncEngineFieldsToPullRequests < ActiveRecord::Migration[8.1]
  def change
    change_table :pull_requests, bulk: true do |t|
      t.string :remote_state, null: false, default: "open"
      t.string :inactive_reason
      t.string :head_sha
      t.string :base_sha
      t.string :head_ref
      t.string :base_ref
      t.datetime :merged_at_github
      t.datetime :closed_at_github
      t.string :latest_review_state
      t.string :review_decision
      t.string :check_status
      t.boolean :draft, null: false, default: false
    end

    add_index :pull_requests, :remote_state
    add_index :pull_requests, :inactive_reason
    add_index :pull_requests, [ :repo_owner, :repo_name, :remote_state, :inactive_reason ], name: "index_pull_requests_on_repo_active_state"
    add_index :pull_requests, :head_sha
  end
end
