class HeaderPresenter
  CACHE_TTL = 1.minute
  PENDING_CACHE_KEY = "header_stats/pending"
  IN_REVIEW_CACHE_KEY = "header_stats/in_review"

  attr_reader :current_repo

  def initialize
    @current_repo = Setting.current_repo
  end

  def repo_name
    return "No repository selected" if current_repo.blank?
    File.basename(current_repo.to_s).sub(%r{/$}, "")
  end

  def pending_count
    Rails.cache.fetch(PENDING_CACHE_KEY, expires_in: CACHE_TTL) do
      PullRequest.pending_review.count
    end
  end

  def in_review_count
    Rails.cache.fetch(IN_REVIEW_CACHE_KEY, expires_in: CACHE_TTL) do
      PullRequest.in_review.count
    end
  end

  def self.invalidate_cache
    Rails.cache.delete(PENDING_CACHE_KEY)
    Rails.cache.delete(IN_REVIEW_CACHE_KEY)
  end
end
