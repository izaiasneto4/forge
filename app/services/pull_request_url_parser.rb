class PullRequestUrlParser
  GITHUB_PR_URL = %r{\Ahttps?://github\.com/(?<owner>[^/]+)/(?<name>[^/]+)/pull/(?<number>\d+)(?:/.*)?\z}.freeze

  def self.parse(url)
    return nil if url.blank?

    match = url.match(GITHUB_PR_URL)
    return nil unless match

    {
      url: "https://github.com/#{match[:owner]}/#{match[:name]}/pull/#{match[:number]}",
      owner: match[:owner],
      name: match[:name],
      number: Integer(match[:number]),
      repo: "#{match[:owner]}/#{match[:name]}"
    }
  end
end
