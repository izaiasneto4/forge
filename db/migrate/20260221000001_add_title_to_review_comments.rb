class AddTitleToReviewComments < ActiveRecord::Migration[8.1]
  def change
    add_column :review_comments, :title, :string
  end
end
