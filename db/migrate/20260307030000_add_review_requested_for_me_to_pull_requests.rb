class AddReviewRequestedForMeToPullRequests < ActiveRecord::Migration[8.1]
  def change
    add_column :pull_requests, :review_requested_for_me, :boolean, null: false, default: false
    add_index :pull_requests, :review_requested_for_me
  end
end
