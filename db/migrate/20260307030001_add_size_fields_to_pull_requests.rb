class AddSizeFieldsToPullRequests < ActiveRecord::Migration[8.1]
  def change
    add_column :pull_requests, :additions, :integer
    add_column :pull_requests, :deletions, :integer
    add_column :pull_requests, :changed_files, :integer
  end
end
