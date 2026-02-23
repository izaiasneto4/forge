require "open3"

class RepoSlugResolver
  GITHUB_REMOTE = %r{github\.com[:/](?<owner>[^/]+)/(?<name>[^/]+?)(?:\.git)?\z}.freeze

  def self.from_remote(remote)
    return nil if remote.blank?

    match = remote.strip.match(GITHUB_REMOTE)
    return nil unless match

    "#{match[:owner]}/#{match[:name]}"
  end

  def self.from_path(path)
    return nil if path.blank? || !Dir.exist?(path)

    remote, status = Open3.capture2("git", "-C", path, "remote", "get-url", "origin")
    return nil unless status.success?

    from_remote(remote)
  rescue
    nil
  end
end
