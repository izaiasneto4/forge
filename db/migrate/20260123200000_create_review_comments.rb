class CreateReviewComments < ActiveRecord::Migration[8.1]
  def change
    create_table :review_comments do |t|
      t.references :review_task, null: false, foreign_key: true
      t.string :file_path, null: false
      t.integer :line_number
      t.string :severity, default: "suggestion", null: false
      t.text :body, null: false
      t.string :status, default: "pending", null: false
      t.text :resolution_note

      t.timestamps
    end

    add_index :review_comments, :file_path
    add_index :review_comments, :severity
    add_index :review_comments, :status
    add_index :review_comments, [ :review_task_id, :file_path ]
  end
end
