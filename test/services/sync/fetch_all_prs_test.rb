require "test_helper"

class Sync::FetchAllPrsTest < ActiveSupport::TestCase
  def response_for(prs)
    JSON.generate(prs)
  end

  def pr_json(number:, url:, title: "PR", body: "Body", owner: "acme", author: "alice")
    {
      "number" => number,
      "title" => title,
      "body" => body,
      "url" => url,
      "author" => { "login" => author, "avatarUrl" => "https://example.com/avatar.png" },
      "headRepositoryOwner" => { "login" => owner },
      "createdAt" => "2026-03-04T10:00:00Z",
      "updatedAt" => "2026-03-04T11:00:00Z"
    }
  end

  test "call combines pending and reviewed prs" do
    service = Sync::FetchAllPrs.new(repo_path: nil, github_login: "alice")
    service.stubs(:run_gh_command)
      .with("pr", "list", "--search", "review-requested:@me", "--json", anything, "--limit", "1000")
      .returns(response_for([ pr_json(number: 1, url: "https://github.com/acme/api/pull/1") ]))
    service.stubs(:run_gh_command)
      .with("pr", "list", "--search", "reviewed-by:@me", "--json", anything, "--limit", "1000")
      .returns(response_for([ pr_json(number: 2, url: "https://github.com/acme/api/pull/2") ]))

    result = service.call

    assert_equal [ 1, 2 ], result.map { |pr| pr[:number] }
    assert_equal %w[pending_review reviewed_by_me], result.map { |pr| pr[:review_status] }
  end

  test "call_with_open_prs removes reviewed duplicates that are still open" do
    service = Sync::FetchAllPrs.new(repo_path: nil, github_login: "alice")
    requested = pr_json(number: 1, url: "https://github.com/acme/api/pull/1")
    reviewed_duplicate = pr_json(number: 2, url: "https://github.com/acme/api/pull/2")
    reviewed_unique = pr_json(number: 3, url: "https://github.com/acme/api/pull/3")

    service.stubs(:run_gh_command)
      .with("pr", "list", "--search", "review-requested:@me", "--json", anything, "--limit", "1000")
      .returns(response_for([ requested ]))
    service.stubs(:run_gh_command)
      .with("pr", "list", "--search", "reviewed-by:@me", "--json", anything, "--limit", "1000")
      .returns(response_for([ reviewed_duplicate, reviewed_unique ]))
    service.stubs(:run_gh_command)
      .with("pr", "list", "--state", "open", "--json", anything, "--limit", "1000")
      .returns(response_for([ requested, reviewed_duplicate ]))

    result = service.call_with_open_prs

    assert_equal [ 1 ], result[:pending_review].map { |pr| pr[:number] }
    assert_equal [ 2, 3 ], result[:reviewed_by_me].map { |pr| pr[:number] }
  end

  test "run_gh_command uses repo path when it exists" do
    Dir.stubs(:exist?).with("/tmp/repo").returns(true)
    Open3.expects(:capture3).with("gh", "api", "user", "--jq", ".login", chdir: "/tmp/repo")
      .returns([ "alice\n", "", stub(success?: true) ])

    service = Sync::FetchAllPrs.new(repo_path: "/tmp/repo", github_login: nil)

    assert_equal "alice", service.instance_variable_get(:@github_login)
  end

  test "run_gh_command raises wrapped error on gh failure" do
    service = Sync::FetchAllPrs.new(repo_path: nil, github_login: "alice")
    Open3.stubs(:capture3).returns([ "", "bad", stub(success?: false) ])

    error = assert_raises(Sync::FetchAllPrs::Error) do
      service.send(:run_gh_command, "api", "user")
    end

    assert_includes error.message, "GitHub CLI error: bad"
  end

  test "parse_pr falls back to head repository owner when url does not match" do
    service = Sync::FetchAllPrs.new(repo_path: nil, github_login: "alice")

    result = service.send(:parse_pr, pr_json(number: 4, url: "https://example.com/custom/4", owner: "fallback"))

    assert_equal "fallback", result[:repo_owner]
    assert_nil result[:repo_name]
  end
end
