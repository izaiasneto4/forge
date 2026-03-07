class CurrentRepoRecoveryService
  def self.call
    new.call
  end

  def call
    current_repo = Setting.current_repo
    return current_repo if current_repo.present? && Dir.exist?(current_repo)
    return nil if Setting.repos_folder.blank?

    repo_slugs = PullRequest.active_remote.distinct.pluck(:repo_owner, :repo_name).map { |owner, name| "#{owner}/#{name}" }.uniq
    return nil unless repo_slugs.size == 1

    resolution = RepoSwitchResolver.new(repos_folder: Setting.repos_folder).resolve(repo_slugs.first)
    return nil unless resolution[:status] == :ok

    Setting.current_repo = resolution[:path]
    resolution[:path]
  end
end
