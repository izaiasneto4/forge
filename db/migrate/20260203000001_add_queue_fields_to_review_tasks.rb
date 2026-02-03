class AddQueueFieldsToReviewTasks < ActiveRecord::Migration[8.0]
  def change
    add_column :review_tasks, :queued_at, :datetime
    add_index :review_tasks, [ :state, :queued_at ]
  end
end
