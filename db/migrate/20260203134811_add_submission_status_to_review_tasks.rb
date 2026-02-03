class AddSubmissionStatusToReviewTasks < ActiveRecord::Migration[8.1]
  def change
    add_column :review_tasks, :submission_status, :string, default: "pending_submission"
    add_column :review_tasks, :submitted_at, :datetime
    add_index :review_tasks, :submission_status
  end
end
