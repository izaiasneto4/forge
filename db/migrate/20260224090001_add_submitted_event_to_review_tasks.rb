class AddSubmittedEventToReviewTasks < ActiveRecord::Migration[8.0]
  def change
    add_column :review_tasks, :submitted_event, :string
    add_index :review_tasks, :submitted_event
  end
end
