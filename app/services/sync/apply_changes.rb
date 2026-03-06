module Sync
  class ApplyChanges
    def initialize(changes:)
      @changes = changes
    end

    def call
      return if no_changes?

      ActiveRecord::Base.transaction do
        apply_creates
        apply_updates
        apply_deletes
      end

      {
        created: @changes[:to_create].size,
        updated: @changes[:to_update].size,
        deleted: @changes[:to_delete].size
      }
    end

    private

    def no_changes?
      @changes[:to_create].empty? && @changes[:to_update].empty? && @changes[:to_delete].empty?
    end

    def apply_creates
      return if @changes[:to_create].empty?

      records = @changes[:to_create].map { |pr_attrs| PullRequest.new(pr_attrs) }

      records.each do |record|
        record.save!
      end
    rescue ActiveRecord::RecordInvalid => e
      Rails.logger.error "Failed to create PR: #{e.message}"
      raise
    end

    def apply_updates
      return if @changes[:to_update].empty?

      @changes[:to_update].each do |existing, fetched_attrs|
        existing.assign_attributes(fetched_attrs)
        existing.save!
      end
    rescue ActiveRecord::RecordInvalid => e
      Rails.logger.error "Failed to update PR: #{e.message}"
      raise
    end

    def apply_deletes
      return if @changes[:to_delete].empty?

      now = Time.current
      ids = @changes[:to_delete].map(&:id)

      PullRequest.where(id: ids).update_all(
        deleted_at: now,
        updated_at: now
      )
    end
  end
end
