class AddAiSummaryToPullRequestSnapshots < ActiveRecord::Migration[8.1]
  def change
    change_table :pull_request_snapshots, bulk: true do |t|
      t.string :ai_summary_status, null: false, default: "none"
      t.datetime :ai_summary_generated_at
      t.text :ai_summary_failure_reason
      t.integer :ai_summary_files_changed
      t.integer :ai_summary_lines_added
      t.integer :ai_summary_lines_removed
      t.text :ai_summary_main_changes
      t.text :ai_summary_risk_areas
    end

    add_index :pull_request_snapshots, :ai_summary_status
  end
end
