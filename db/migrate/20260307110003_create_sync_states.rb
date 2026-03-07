class CreateSyncStates < ActiveRecord::Migration[8.1]
  def change
    create_table :sync_states do |t|
      t.string :scope_key, null: false
      t.string :repo_owner
      t.string :repo_name
      t.string :status, null: false, default: "idle"
      t.datetime :last_started_at
      t.datetime :last_finished_at
      t.datetime :last_succeeded_at
      t.text :last_error
      t.integer :fetched_count, null: false, default: 0
      t.integer :created_count, null: false, default: 0
      t.integer :updated_count, null: false, default: 0
      t.integer :deactivated_count, null: false, default: 0

      t.timestamps
    end

    add_index :sync_states, :scope_key, unique: true
  end
end
