class AddPullRequestSnapshotToReviewTasks < ActiveRecord::Migration[8.1]
  def change
    add_reference :review_tasks, :pull_request_snapshot, foreign_key: true
  end
end
