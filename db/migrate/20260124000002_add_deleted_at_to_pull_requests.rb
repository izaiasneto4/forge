class AddDeletedAtToPullRequests < ActiveRecord::Migration[8.1]
  def change
    add_column :pull_requests, :deleted_at, :datetime
    add_index :pull_requests, :deleted_at
  end
end
