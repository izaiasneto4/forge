class AddRetryFieldsToReviewTasks < ActiveRecord::Migration[8.1]
  def change
    add_column :review_tasks, :retry_count, :integer, default: 0, null: false
    add_column :review_tasks, :last_retry_at, :datetime
    add_column :review_tasks, :failure_reason, :text
    add_column :review_tasks, :retry_history, :text

    add_index :review_tasks, :retry_count
  end
end
