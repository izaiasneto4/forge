module Sync
  class DiffEngine
    attr_reader :to_create, :to_update, :to_delete

    def initialize(fetched_prs:, repo_path:)
      @fetched_prs = fetched_prs
      @repo_path = repo_path
      @to_create = []
      @to_update = []
      @to_delete = []
    end

    def call
      return empty_result if @fetched_prs.blank?

      repo_info = get_repo_info
      return empty_result unless repo_info

      existing_prs = PullRequest.unscoped
        .where(repo_owner: repo_info[:owner], repo_name: repo_info[:name])
        .index_by(&:github_id)

      fetched_ids = @fetched_prs.map { |pr| pr[:github_id] }.to_set

      @fetched_prs.each do |fetched|
        github_id = fetched[:github_id]
        existing = existing_prs[github_id]

        if existing.nil?
          @to_create << fetched
        elsif existing.deleted_at.present?
          @to_update << [existing, fetched.merge(deleted_at: nil, archived: false)]
        elsif pr_changed?(existing, fetched)
          @to_update << [existing, fetched]
        end
      end

      existing_prs.each do |github_id, pr|
        next if pr.deleted_at.present?
        next if pr.archived?

        unless fetched_ids.include?(github_id)
          @to_delete << pr
        end
      end

      {
        to_create: @to_create,
        to_update: @to_update,
        to_delete: @to_delete
      }
    end

    private

    def empty_result
      { to_create: [], to_update: [], to_delete: [] }
    end

    def get_repo_info
      return @repo_info if defined?(@repo_info)

      @repo_info = nil
      return @repo_info unless @repo_path.present? && Dir.exist?(@repo_path)

      remote, status = Open3.capture2("git", "-C", @repo_path, "remote", "get-url", "origin")
      return @repo_info unless status.success?

      remote = remote.strip
      return @repo_info if remote.empty?

      if remote =~ %r{github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$}
        @repo_info = { owner: $1, name: $2 }
      end

      @repo_info
    rescue
      @repo_info = nil
    end

    SYNCED_FIELDS = %w[title description url author author_avatar created_at_github updated_at_github review_status].freeze

    def pr_changed?(existing, fetched)
      SYNCED_FIELDS.any? do |field|
        existing_value = existing.public_send(field)
        fetched_value = fetched[field.to_sym]

        if field.ends_with?("_at_github")
          existing_value&.to_s != fetched_value
        else
          existing_value != fetched_value
        end
      end
    end
  end
end