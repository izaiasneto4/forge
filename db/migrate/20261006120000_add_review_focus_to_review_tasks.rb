class AddReviewFocusToReviewTasks < ActiveRecord::Migration[8.1]
  def change
    add_column :review_tasks, :review_focus, :text
  end
end
