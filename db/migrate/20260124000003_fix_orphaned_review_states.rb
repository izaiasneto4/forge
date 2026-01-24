class FixOrphanedReviewStates < ActiveRecord::Migration[8.1]
  def up
    # Fix any existing PRs that have reviewed/in_review/failed status but no review_task
    # This can happen after database wipes or cascading deletes

    # Direct SQL approach to avoid validation issues during migration
    execute <<-SQL
      UPDATE pull_requests
      SET review_status = 'pending_review'
      WHERE review_status IN ('reviewed_by_me', 'in_review', 'review_failed')
        AND id NOT IN (
          SELECT DISTINCT pull_request_id
          FROM review_tasks
        )
        AND deleted_at IS NULL
    SQL
  end

  def down
    # No need to reverse - this is a data cleanup operation
  end
end
