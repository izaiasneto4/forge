class CreatePullRequestSnapshots < ActiveRecord::Migration[8.1]
  def change
    create_table :pull_request_snapshots do |t|
      t.references :pull_request, null: false, foreign_key: true
      t.string :head_sha, null: false
      t.string :base_sha, null: false
      t.string :status, null: false, default: "current"
      t.string :stale_reason
      t.datetime :synced_at

      t.timestamps
    end

    add_index :pull_request_snapshots, [ :pull_request_id, :head_sha, :base_sha ], unique: true, name: "index_pr_snapshots_on_pull_request_and_revision"
    add_index :pull_request_snapshots, [ :pull_request_id, :status ], name: "index_pr_snapshots_on_pull_request_and_status"
  end
end
