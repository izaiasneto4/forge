class AddPerformanceIndexes < ActiveRecord::Migration[8.1]
  def change
    add_index :pull_requests, [ :repo_owner, :repo_name ], name: "index_pull_requests_on_repo_owner_and_name"
    add_index :review_tasks, [ :pull_request_id, :state ], name: "index_review_tasks_on_pull_request_id_and_state"
    add_index :pull_requests, [ :repo_owner, :repo_name, :archived, :deleted_at, :review_status ], name: "index_pull_requests_repo_filter"
    add_index :review_tasks, [ :state, :archived ], name: "index_review_tasks_state_archived"
    add_index :pull_requests, :updated_at_github, name: "index_pull_requests_on_updated_at_github"
  end
end
