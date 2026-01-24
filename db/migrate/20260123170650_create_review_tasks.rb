class CreateReviewTasks < ActiveRecord::Migration[8.1]
  def change
    create_table :review_tasks do |t|
      t.references :pull_request, null: false, foreign_key: true
      t.string :state, default: "pending_review", null: false
      t.string :worktree_path
      t.text :review_output
      t.datetime :started_at
      t.datetime :completed_at

      t.timestamps
    end

    add_index :review_tasks, :state
  end
end
