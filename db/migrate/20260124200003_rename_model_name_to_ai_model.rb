class RenameModelNameToAiModel < ActiveRecord::Migration[8.1]
  def change
    rename_column :review_tasks, :model_name, :ai_model
    rename_column :review_iterations, :model_name, :ai_model
  end
end
