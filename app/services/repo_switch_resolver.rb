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
    return { status: :ambiguous, paths: matches } if matches.size > 1

    { status: :ok, path: matches.first }
  end
end
