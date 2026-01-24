class AddCliClientToReviewTasks < ActiveRecord::Migration[8.1]
  def change
    add_column :review_tasks, :cli_client, :string, default: "claude", null: false
  end
end
