class AddCounterCache < ActiveRecord::Migration[8.1]
  def change
    add_column :pull_requests, :review_tasks_count, :integer, default: 0
    add_index :pull_requests, :review_tasks_count, name: "index_pull_requests_on_review_tasks_count"
  end
end
