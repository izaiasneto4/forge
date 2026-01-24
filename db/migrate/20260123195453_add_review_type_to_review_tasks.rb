class AddReviewTypeToReviewTasks < ActiveRecord::Migration[8.1]
  def change
    add_column :review_tasks, :review_type, :string, default: "review", null: false
  end
end
