class Api::V1::RepositoriesController < Api::V1::BaseController
  def create
    slug = params.require(:repo)
    unless slug.match?(/\A[^\/]+\/[^\/]+\z/)
      return render_error("invalid_input", "repo must be in org/repo format")
    end

    resolver = RepoSwitchResolver.new(repos_folder: Setting.repos_folder)
    resolution = resolver.resolve(slug)

    case resolution[:status]
    when :not_found
      return render_error("not_found", "No local repository matched #{slug}", :not_found)
    when :ambiguous
      return render_error("conflict", "Multiple local repositories matched #{slug}", :conflict, details: { paths: resolution[:paths] })
    end

    repo_path = resolution[:path]
    Setting.current_repo = repo_path

    GithubCliService.fetch_latest_for_repo(repo_path)
    GithubCliService.new(repo_path: repo_path).sync_to_database!
    Setting.touch_last_synced!

    render_ok({ repo_path: repo_path, repo: slug, synced: true }, :created)
  rescue GithubCliService::Error => e
    render_error("sync_failed", "Switched repo but sync failed: #{e.message}")
  end
end
