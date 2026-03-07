class RepoSwitchResolver
  def initialize(repos_folder:)
    @repos_folder = repos_folder
  end

  def resolve(slug)
    return { status: :not_found, paths: [] } if @repos_folder.blank? || !Dir.exist?(@repos_folder)

    matches = RepoScannerService.new(@repos_folder).scan.filter_map do |repo|
      repo[:path] if RepoSlugResolver.from_remote(repo[:remote_url]) == slug
    end

    return { status: :not_found, paths: [] } if matches.empty?
    return { status: :ok, path: matches.first } if matches.size == 1

    preferred = prefer_exact_repo_dir(matches, slug)
    return { status: :ok, path: preferred } if preferred.present?

    { status: :ambiguous, paths: matches }
  end

  private

  def prefer_exact_repo_dir(paths, slug)
    repo_name = slug.split("/", 2).last
    exact_matches = paths.select { |path| File.basename(path) == repo_name }
    return nil unless exact_matches.size == 1

    exact_matches.first
  end
end
