class AddArchivedToPullRequestsAndReviewTasks < ActiveRecord::Migration[8.0]
  def change
    add_column :pull_requests, :archived, :boolean, default: false, null: false
    add_column :review_tasks, :archived, :boolean, default: false, null: false
  end
end
