class AddModelNameToReviewTasks < ActiveRecord::Migration[8.1]
  def change
    add_column :review_tasks, :model_name, :string
    add_index :review_tasks, :model_name
  end
end
