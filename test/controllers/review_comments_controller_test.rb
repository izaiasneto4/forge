require "test_helper"

class ReviewCommentsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @pr = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/test/repo/pull/1",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review",
      updated_at_github: Time.current
    )
    @review_task = ReviewTask.create!(
      pull_request: @pr,
      state: "reviewed"
    )
    @comment = ReviewComment.create!(
      review_task: @review_task,
      body: "Test comment",
      file_path: "test.rb",
      line_number: 10,
      status: "pending"
    )
  end

  test "toggle cycles status from pending to addressed" do
    patch toggle_review_comment_path(@comment), as: :turbo_stream

    assert_response :success
    @comment.reload
    assert_equal "addressed", @comment.status
  end

  test "toggle cycles status from addressed to dismissed" do
    @comment.update!(status: "addressed")

    patch toggle_review_comment_path(@comment), as: :turbo_stream

    assert_response :success
    @comment.reload
    assert_equal "dismissed", @comment.status
  end

  test "toggle cycles status from dismissed to pending" do
    @comment.update!(status: "dismissed")

    patch toggle_review_comment_path(@comment), as: :turbo_stream

    assert_response :success
    @comment.reload
    assert_equal "pending", @comment.status
  end

  test "toggle with HTML response" do
    patch toggle_review_comment_path(@comment)

    assert_redirected_to review_task_path(@review_task)
  end

  test "toggle with JSON response" do
    patch toggle_review_comment_path(@comment), as: :json

    assert_response :success

    json = JSON.parse(response.body)
    assert_equal "addressed", json["status"]
  end

  test "submit with no selected comments" do
    @comment.update!(status: "addressed")
    post submit_review_task_review_comments_path(@review_task)

    assert_redirected_to review_task_path(@review_task)
    assert_equal "No comments selected for submission", flash[:alert]
  end

  test "submit with no pending comments" do
    @comment.update!(status: "addressed")

    post submit_review_task_review_comments_path(@review_task), as: :turbo_stream

    assert_response :success
    assert_includes response.body, "No comments selected for submission"
  end

  test "submit with no pending comments JSON response" do
    @comment.update!(status: "addressed")

    post submit_review_task_review_comments_path(@review_task), as: :json

    assert_response :unprocessable_entity

    json = JSON.parse(response.body)
    assert_equal false, json["success"]
    assert_equal "No comments selected", json["error"]
  end

  test "submit with selected comments via comment_ids" do
    comment2 = ReviewComment.create!(
      review_task: @review_task,
      body: "Another comment",
      file_path: "test2.rb",
      line_number: 20,
      status: "pending"
    )

    submitter = Class.new do
      def submit_review(*)
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task),
         params: { comment_ids: [ @comment.id ] }, as: :turbo_stream

    assert_response :success
    @comment.reload
    assert_equal "addressed", @comment.status

    comment2.reload
    assert_equal "pending", comment2.status
  end

  test "submit with all pending comments by default" do
    comment2 = ReviewComment.create!(
      review_task: @review_task,
      body: "Another comment",
      file_path: "test2.rb",
      line_number: 20,
      status: "pending"
    )

    submitter = Class.new do
      def submit_review(*)
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task), as: :turbo_stream

    assert_response :success
    @comment.reload
    assert_equal "addressed", @comment.status

    comment2.reload
    assert_equal "addressed", comment2.status
  end

  test "submit with success HTML response" do
    submitter = Class.new do
      def submit_review(*)
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task)

    assert_redirected_to review_task_path(@review_task)
    assert_equal "Review submitted successfully to GitHub", flash[:notice]

    @comment.reload
    assert_equal "addressed", @comment.status
  end

  test "submit with success JSON response" do
    submitter = Class.new do
      def submit_review(*)
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task), as: :json

    assert_response :success

    json = JSON.parse(response.body)
    assert_equal true, json["success"]
    assert json.key?("result")
  end

  test "submit with custom event" do
    submitter = Class.new do
      def submit_review(*)
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task),
         params: { event: "APPROVE", summary: "LGTM!" }, as: :turbo_stream

    assert_response :success
  end

  test "submit allows approve without comments when explicitly requested" do
    submitter = Class.new do
      attr_reader :event, :comments, :summary

      def submit_review(event:, summary:, comments:)
        @event = event
        @summary = summary
        @comments = comments
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task),
         params: { event: "APPROVE", force_empty_submission: "true" }, as: :turbo_stream

    assert_response :success
    @comment.reload
    assert_equal "pending", @comment.status
    assert_equal "APPROVE", submitter.event
    assert_equal [], submitter.comments.to_a
    assert_nil submitter.summary
  end

  test "submit with REQUEST_CHANGES moves task and PR to waiting_implementation" do
    @pr.update!(review_status: "reviewed_by_me")
    submitter = Class.new do
      def submit_review(*)
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task),
         params: { event: "REQUEST_CHANGES" }, as: :turbo_stream

    assert_response :success
    @review_task.reload
    @pr.reload
    assert_equal "waiting_implementation", @review_task.state
    assert_equal "waiting_implementation", @pr.review_status
    assert_equal "REQUEST_CHANGES", @review_task.submitted_event
  end

  test "submit with APPROVE moves review to done column" do
    @pr.update!(review_status: "reviewed_by_me")
    submitter = Class.new do
      def submit_review(*)
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task),
         params: { event: "APPROVE" }, as: :turbo_stream

    assert_response :success
    @review_task.reload
    @pr.reload
    assert_equal "done", @review_task.state
    assert_equal "reviewed_by_others", @pr.review_status
    assert_equal "APPROVE", @review_task.submitted_event
  end

  test "submit with empty APPROVE moves task/PR to done column" do
    @pr.update!(review_status: "reviewed_by_me")
    submitter = Class.new do
      def submit_review(*)
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task),
         params: { event: "APPROVE", force_empty_submission: "true" }, as: :turbo_stream

    assert_response :success
    @review_task.reload
    @pr.reload
    assert_equal "done", @review_task.state
    assert_equal "reviewed_by_others", @pr.review_status
    assert_equal "APPROVE", @review_task.submitted_event
  end

  test "submit infers REQUEST_CHANGES for major comments when event omitted" do
    @pr.update!(review_status: "reviewed_by_me")
    @comment.update!(severity: "major")
    submitter = Class.new do
      attr_reader :event

      def submit_review(event:, **)
        @event = event
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task),
         params: { event: "" }, as: :turbo_stream

    assert_response :success
    @review_task.reload
    @pr.reload
    assert_equal "REQUEST_CHANGES", submitter.event
    assert_equal "waiting_implementation", @review_task.state
    assert_equal "waiting_implementation", @pr.review_status
    assert_equal "REQUEST_CHANGES", @review_task.submitted_event
  end

  test "submit with error from GithubReviewSubmitter" do
    submitter = Class.new do
      def submit_review(*)
        raise GithubReviewSubmitter::Error, "API error"
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task), as: :turbo_stream

    assert_response :success
    assert_includes response.body, "API error"

    @comment.reload
    assert_equal "pending", @comment.status
  end

  test "submit with error HTML response" do
    submitter = Class.new do
      def submit_review(*)
        raise GithubReviewSubmitter::Error, "API error"
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task)

    assert_redirected_to review_task_path(@review_task)
    assert_equal "Failed to submit review: API error", flash[:alert]

    @comment.reload
    assert_equal "pending", @comment.status
  end

  test "submit with error JSON response" do
    submitter = Class.new do
      def submit_review(*)
        raise GithubReviewSubmitter::Error, "API error"
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task), as: :json

    assert_response :unprocessable_entity

    json = JSON.parse(response.body)
    assert_equal false, json["success"]
    assert_equal "API error", json["error"]
  end

  test "submit marks only selected comments as addressed" do
    comment2 = ReviewComment.create!(
      review_task: @review_task,
      body: "Another comment",
      file_path: "test2.rb",
      line_number: 20,
      status: "pending"
    )

    submitter = Class.new do
      def submit_review(*)
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task),
         params: { comment_ids: [ @comment.id ] }, as: :turbo_stream

    @comment.reload
    assert_equal "addressed", @comment.status

    comment2.reload
    assert_equal "pending", comment2.status
  end

  test "submit handles empty event and summary params" do
    submitter = Class.new do
      def submit_review(*)
        { result: "success" }
      end
    end.new
    GithubReviewSubmitter.stubs(:new).returns(submitter)

    post submit_review_task_review_comments_path(@review_task),
         params: { event: "", summary: "" }, as: :turbo_stream

    assert_response :success
  end
end
