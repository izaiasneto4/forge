require "test_helper"

class ReviewLifecycleBackfillServiceTest < ActiveSupport::TestCase
  class FakeGithubService
    def initialize(requested_map:, latest_map:)
      @requested_map = requested_map
      @latest_map = latest_map
    end

    def review_requested_for_me?(pull_request)
      @requested_map.fetch(pull_request.number, false)
    end

    def latest_my_review_state(pull_request)
      @latest_map[pull_request.number]
    end
  end

  test "dry-run plans waiting transition without persisting" do
    pr, task = create_submitted_review(number: 401)
    github = FakeGithubService.new(
      requested_map: { 401 => false },
      latest_map: { 401 => "CHANGES_REQUESTED" }
    )
    output = StringIO.new

    result = ReviewLifecycleBackfillService.new(github_service: github, io: output).run(apply: false)

    task.reload
    pr.reload

    assert_equal "dry-run", result[:mode]
    assert_equal 1, result[:processed]
    assert_equal 0, result[:updated]
    assert_equal "reviewed", task.state
    assert_equal "reviewed_by_me", pr.review_status
    assert_match(/move_to_waiting/, output.string)
  end

  test "apply moves changes-requested review to waiting_implementation" do
    pr, task = create_submitted_review(number: 402)
    github = FakeGithubService.new(
      requested_map: { 402 => false },
      latest_map: { 402 => "CHANGES_REQUESTED" }
    )

    result = ReviewLifecycleBackfillService.new(github_service: github, io: StringIO.new).run(apply: true)

    task.reload
    pr.reload

    assert_equal 1, result[:updated]
    assert_equal "waiting_implementation", task.state
    assert_equal "waiting_implementation", pr.review_status
    assert_equal "REQUEST_CHANGES", task.submitted_event
  end

  test "apply resets to pending when review is requested again" do
    pr, task = create_submitted_review(number: 403, with_output: true)
    github = FakeGithubService.new(
      requested_map: { 403 => true },
      latest_map: { 403 => "CHANGES_REQUESTED" }
    )

    result = ReviewLifecycleBackfillService.new(github_service: github, io: StringIO.new).run(apply: true)

    task.reload
    pr.reload

    assert_equal 1, result[:updated]
    assert_equal "pending_review", task.state
    assert_equal "pending_review", pr.review_status
    assert_equal "pending_submission", task.submission_status
    assert_nil task.submitted_at
    assert_nil task.submitted_event
    assert_equal 1, task.review_iterations.count
  end

  test "apply normalizes reviewed event metadata for approvals" do
    pr, task = create_submitted_review(number: 404)
    github = FakeGithubService.new(
      requested_map: { 404 => false },
      latest_map: { 404 => "APPROVED" }
    )

    ReviewLifecycleBackfillService.new(github_service: github, io: StringIO.new).run(apply: true)
    task.reload
    pr.reload

    assert_equal "reviewed", task.state
    assert_equal "reviewed_by_me", pr.review_status
    assert_equal "APPROVE", task.submitted_event
  end

  private

  def create_submitted_review(number:, with_output: false)
    pr = PullRequest.create!(
      github_id: number,
      number: number,
      title: "PR #{number}",
      url: "https://github.com/test/repo/pull/#{number}",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
    task = ReviewTask.create!(
      pull_request: pr,
      state: "reviewed",
      submission_status: "submitted",
      submitted_at: Time.current,
      review_output: with_output ? "prior output" : nil
    )
    if with_output
      ReviewComment.create!(
        review_task: task,
        body: "Prior comment",
        file_path: "app/services/foo.rb",
        severity: "major"
      )
    end
    pr.update!(review_status: "reviewed_by_me")
    [ pr, task ]
  end
end
