class CreatePullRequests < ActiveRecord::Migration[8.1]
  def change
    create_table :pull_requests do |t|
      t.integer :github_id
      t.integer :number
      t.string :title
      t.text :description
      t.string :url
      t.string :repo_owner
      t.string :repo_name
      t.string :author
      t.string :author_avatar
      t.string :review_status
      t.datetime :created_at_github
      t.datetime :updated_at_github

      t.timestamps
    end
    add_index :pull_requests, :github_id
    add_index :pull_requests, :review_status
  end
end
