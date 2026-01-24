class CreateReviewIterations < ActiveRecord::Migration[8.1]
  def change
    create_table :review_iterations do |t|
      t.references :review_task, null: false, foreign_key: true
      t.integer :iteration_number, null: false, default: 1
      t.text :review_output
      t.string :cli_client, null: false
      t.string :review_type, null: false, default: "review"
      t.string :from_state, null: false
      t.string :to_state, null: false
      t.datetime :started_at
      t.datetime :completed_at

      t.timestamps

      t.index [ :review_task_id, :iteration_number ], unique: true
    end
  end
end
