class CreateAgentLogs < ActiveRecord::Migration[8.1]
  def change
    create_table :agent_logs do |t|
      t.references :review_task, null: false, foreign_key: true
      t.string :log_type, null: false, default: "output"
      t.text :message

      t.timestamps
    end

    add_index :agent_logs, :log_type
    add_index :agent_logs, :created_at
  end
end
