class AddUniqueRepoNumberIndexToPullRequests < ActiveRecord::Migration[8.1]
  def change
    add_index :pull_requests, [ :repo_owner, :repo_name, :number ],
      unique: true,
      name: "index_pull_requests_on_repo_and_number_unique"
  end
end
