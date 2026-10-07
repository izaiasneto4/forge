require "test_helper"

class Api::V1::ReviewTaskSubmissionsControllerTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  setup do
    clean_tables
    pull_request = PullRequest.create!(
      github_id: 3,
      number: 3,
      title: "Submission",
      url: "https://github.com/acme/api/pull/3",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )
    @task = pull_request.create_review_task!(state: "reviewed")
    @included = @task.review_comments.create!(file_path: "app/a.rb", body: "Included", severity: "major", status: "pending")
    @excluded = @task.review_comments.create!(file_path: "app/b.rb", body: "Excluded", severity: "minor", status: "pending")
  end

  teardown do
    clean_tables
  end

  test "an explicitly empty selection submits nothing" do
    pending = "pending"
    GithubReviewSubmitter.any_instance.expects(:submit_review).never

    post "/api/v1/review_tasks/#{@task.id}/submissions", params: { event: "COMMENT", summary: "Looks fine", comment_ids: [] }, as: :json

    assert_response :unprocessable_entity
    assert_equal [ pending ], @task.review_comments.reload.map(&:status).uniq
  end

  test "only the selected comments are submitted" do
    addressed = "addressed"
    pending = "pending"
    submitted_ids = nil
    GithubReviewSubmitter.any_instance.expects(:submit_review).with { |comments:, **| submitted_ids = comments.map(&:id) }.returns({})

    post "/api/v1/review_tasks/#{@task.id}/submissions", params: { event: "COMMENT", comment_ids: [ @included.id ] }, as: :json

    assert_response :success
    assert_equal [ @included.id ], submitted_ids
    assert_equal addressed, @included.reload.status
    assert_equal pending, @excluded.reload.status
  end

  private

  def clean_tables
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
  end
end
