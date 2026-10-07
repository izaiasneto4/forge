class AddFileTriageToSnapshots < ActiveRecord::Migration[8.1]
  def change
    change_table :pull_request_snapshots, bulk: true do |t|
      t.string :file_triage_status, null: false, default: "none"
      t.datetime :file_triage_generated_at
      t.text :file_triage_failure_reason
    end

    add_index :pull_request_snapshots, :file_triage_status

    create_table :pull_request_file_triages do |t|
      t.references :pull_request_snapshot, null: false, foreign_key: true, index: false
      t.string :path, null: false
      t.string :status, null: false, default: "modified"
      t.integer :additions, null: false, default: 0
      t.integer :deletions, null: false, default: 0
      t.string :role, null: false, default: "chore"
      t.float :core_score, null: false, default: 0.0
      t.float :risk_score, null: false, default: 0.0
      t.float :must_read_p, null: false, default: 0.0
      t.float :priority, null: false, default: 0.0
      t.float :confidence, null: false, default: 0.0
      t.boolean :skipped, null: false, default: false
      t.string :skip_reason
      t.text :why
      t.text :raw_jev_response
      t.integer :rank

      t.timestamps
    end

    add_index :pull_request_file_triages,
              [ :pull_request_snapshot_id, :path ],
              unique: true,
              name: "index_file_triages_on_snapshot_and_path"
    add_index :pull_request_file_triages,
              [ :pull_request_snapshot_id, :priority ],
              name: "index_file_triages_on_snapshot_and_priority"
  end
end
