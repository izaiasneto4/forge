require "test_helper"

class HeaderPresenterTest < ActiveSupport::TestCase
  setup do
    Rails.cache.clear
    Setting.delete_all
  end

  test "initialize sets current_repo from Setting" do
    Setting.current_repo = "/path/to/repo"
    presenter = HeaderPresenter.new
    assert_equal "/path/to/repo", presenter.current_repo
  end

  test "initialize handles nil current_repo" do
    Setting.current_repo = nil
    presenter = HeaderPresenter.new
    assert_nil presenter.current_repo
  end

  test "repo_name returns 'No repository selected' when nil" do
    Setting.current_repo = nil
    presenter = HeaderPresenter.new
    assert_equal "No repository selected", presenter.repo_name
  end

  test "repo_name returns 'No repository selected' when blank" do
    Setting.current_repo = ""
    presenter = HeaderPresenter.new
    assert_equal "No repository selected", presenter.repo_name
  end

  test "repo_name handles path with trailing slash" do
    Setting.current_repo = "/path/to/repo/"
    presenter = HeaderPresenter.new
    assert_equal "repo", presenter.repo_name
  end

  test "repo_name handles path with multiple trailing slashes" do
    Setting.current_repo = "/path/to/repo///"
    presenter = HeaderPresenter.new
    assert_equal "repo", presenter.repo_name
  end

  test "repo_name handles normal path" do
    Setting.current_repo = "/path/to/repo"
    presenter = HeaderPresenter.new
    assert_equal "repo", presenter.repo_name
  end

  test "repo_name handles path with dot in name" do
    Setting.current_repo = "/path/to/my.repo"
    presenter = HeaderPresenter.new
    assert_equal "my.repo", presenter.repo_name
  end

  test "pending_count returns zero when no PRs" do
    Setting.current_repo = nil
    presenter = HeaderPresenter.new
    assert_equal 0, presenter.pending_count
  end

  test "pending_count uses Rails.cache" do
    Setting.current_repo = nil
    pr = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/owner/repo/pull/1",
      review_status: "pending_review",
      repo_owner: "owner",
      repo_name: "repo"
    )

    presenter = HeaderPresenter.new
    assert_equal 1, presenter.pending_count
  end

  test "pending_count fetches correct count" do
    Setting.current_repo = nil
    PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/owner/repo/pull/1",
      review_status: "pending_review",
      repo_owner: "owner",
      repo_name: "repo"
    )
    PullRequest.create!(
      github_id: 124,
      number: 2,
      title: "Test PR 2",
      url: "https://github.com/owner/repo/pull/2",
      review_status: "pending_review",
      repo_owner: "owner",
      repo_name: "repo"
    )

    presenter = HeaderPresenter.new
    assert_equal 2, presenter.pending_count
  end

  test "in_review_count returns zero when no PRs" do
    Setting.current_repo = nil
    presenter = HeaderPresenter.new
    assert_equal 0, presenter.in_review_count
  end

  test "in_review_count uses Rails.cache" do
    Setting.current_repo = nil
    pr = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/owner/repo/pull/1",
      review_status: "pending_review",
      repo_owner: "owner",
      repo_name: "repo"
    )
    ReviewTask.create!(
      pull_request: pr,
      state: "in_review"
    )
    pr.update!(review_status: "in_review")

    presenter = HeaderPresenter.new
    assert_equal 1, presenter.in_review_count
  end

  test "in_review_count returns correct count" do
    Setting.current_repo = nil
    pr1 = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/owner/repo/pull/1",
      review_status: "pending_review",
      repo_owner: "owner",
      repo_name: "repo"
    )
    ReviewTask.create!(
      pull_request: pr1,
      state: "in_review"
    )
    pr1.update!(review_status: "in_review")

    pr2 = PullRequest.create!(
      github_id: 124,
      number: 2,
      title: "Test PR 2",
      url: "https://github.com/owner/repo/pull/2",
      review_status: "pending_review",
      repo_owner: "owner",
      repo_name: "repo"
    )
    ReviewTask.create!(
      pull_request: pr2,
      state: "in_review"
    )
    pr2.update!(review_status: "in_review")

    presenter = HeaderPresenter.new
    assert_equal 2, presenter.in_review_count
  end

  test "invalidate_cache clears pending_count cache" do
    Setting.current_repo = nil
    presenter = HeaderPresenter.new
    initial_count = presenter.pending_count

    PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/owner/repo/pull/1",
      review_status: "pending_review",
      repo_owner: "owner",
      repo_name: "repo"
    )

    HeaderPresenter.invalidate_cache

    new_count = presenter.pending_count
    assert_equal 1, new_count
  end

  test "invalidate_cache clears in_review_count cache" do
    Setting.current_repo = nil
    presenter = HeaderPresenter.new
    initial_count = presenter.in_review_count

    pr = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/owner/repo/pull/1",
      review_status: "pending_review",
      repo_owner: "owner",
      repo_name: "repo"
    )
    ReviewTask.create!(
      pull_request: pr,
      state: "in_review"
    )
    pr.update!(review_status: "in_review")

    HeaderPresenter.invalidate_cache

    new_count = presenter.in_review_count
    assert_equal 1, new_count
  end

  test "invalidate_cache works when cache is empty" do
    HeaderPresenter.invalidate_cache
    assert_nothing_raised do
      HeaderPresenter.invalidate_cache
    end
  end

  test "counts only include non-deleted PRs" do
    Setting.current_repo = nil
    # Create pending PR
    pending_pr = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/owner/repo/pull/1",
      review_status: "pending_review",
      repo_owner: "owner",
      repo_name: "repo"
    )

    # Create deleted pending PR
    deleted_pr = PullRequest.create!(
      github_id: 124,
      number: 2,
      title: "Test PR 2",
      url: "https://github.com/owner/repo/pull/2",
      review_status: "pending_review",
      repo_owner: "owner",
      repo_name: "repo"
    )
    deleted_pr.update!(deleted_at: Time.current)

    presenter = HeaderPresenter.new
    assert_equal 1, presenter.pending_count
  end

  test "handles concurrent presenter creation" do
    Setting.current_repo = nil

    presenters = Array.new(5) { HeaderPresenter.new }
    presenters.each do |presenter|
      assert_nil presenter.current_repo
      assert_equal "No repository selected", presenter.repo_name
    end
  end
end
