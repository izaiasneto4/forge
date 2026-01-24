class AddModelNameToReviewIterations < ActiveRecord::Migration[8.1]
  def change
    add_column :review_iterations, :model_name, :string
    add_index :review_iterations, :model_name
  end
end
