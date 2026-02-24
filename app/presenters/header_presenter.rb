class HeaderPresenter
  CACHE_TTL = 1.minute

  attr_reader :current_repo

  def initialize
    @current_repo = Setting.current_repo
  end

  def repo_name
    return "No repository selected" if current_repo.blank?
    File.basename(current_repo.to_s).sub(%r{/$}, "")
  end

  def pending_count
    cache_key = current_repo.blank? ? "header_stats/pending/all" : pending_cache_key

    Rails.cache.fetch(cache_key, expires_in: CACHE_TTL) do
      if current_repo.blank?
        PullRequest.pending_review.count
      else
        PullRequest.for_current_repo(current_repo).pending_review.count
      end
    end
  rescue
    0
  end

  def in_review_count
    cache_key = current_repo.blank? ? "header_stats/in_review/all" : in_review_cache_key

    Rails.cache.fetch(cache_key, expires_in: CACHE_TTL) do
      if current_repo.blank?
        PullRequest.in_review.count
      else
        PullRequest.for_current_repo(current_repo).in_review.count
      end
    end
  rescue
    0
  end

  def last_synced_at
    Setting.last_synced_at
  end

  def last_synced_ago
    return nil unless last_synced_at
    ActionController::Base.helpers.time_ago_in_words(last_synced_at)
  end

  def self.invalidate_cache(repo = nil)
    if repo
      Rails.cache.delete("header_stats/pending/#{repo}")
      Rails.cache.delete("header_stats/in_review/#{repo}")
    else
      Rails.cache.delete_matched("header_stats/*")
    end
  end

  private

  def pending_cache_key
    "header_stats/pending/#{current_repo}"
  end

  def in_review_cache_key
    "header_stats/in_review/#{current_repo}"
  end
end
